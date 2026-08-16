import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { PLACE_DICTIONARY_VERSION } from "./place-dictionary-version.js";
import { enqueueNotification } from "../lib/notifications.js";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const PIPELINE_PREFIX = "atlas:place-pipeline:";
const REQUESTS_KEY = `${PIPELINE_PREFIX}requests`;
const RATE_LIMIT_PREFIX = `${PIPELINE_PREFIX}ratelimit:`;
const RATE_LIMIT = 10;
const RATE_WINDOW_SEC = 300;

function resolveDataFile(...segments) {
  const candidates = [
    join(process.cwd(), ...segments),
    join(process.cwd(), "..", ...segments),
    join(process.cwd(), "..", "..", ...segments),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

const FALLBACK_STATUS_FILE = resolveDataFile("data", "place-pipeline-status.json");
const DICTIONARY_VERSION_FILE = resolveDataFile("data", "place-dictionary-version.json");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function readJsonFile(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function readFallbackStatus() {
  return readJsonFile(FALLBACK_STATUS_FILE, {
    updatedAt: null,
    source: "redis",
    endpoint: "/api/place-pipeline",
    dictionaryVersion: null,
    openRequests: [],
    approvedCountries: [],
    rejectedRequests: [],
    needsReview: [],
    totals: { open: 0, approved: 0, rejected: 0, review: 0 },
  });
}

function readDictionaryVersion() {
  const meta = readJsonFile(DICTIONARY_VERSION_FILE, null);
  return typeof meta?.version === "string" ? meta.version : null;
}

async function redisCmd(...args) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) throw new Error("Redis env vars are missing");
  const res = await fetch(`${UPSTASH_URL}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

async function redisPipeline(commands) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) throw new Error("Redis env vars are missing");
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  const json = await res.json();
  for (const item of json) {
    if (item.error) throw new Error(item.error);
  }
  return json.map((item) => item.result);
}

function safeJsonParse(value) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function publicRecord(record) {
  return {
    id: record.id,
    requestedName: record.requestedName,
    requestedKey: record.requestedKey,
    canonicalName: record.canonicalName ?? null,
    status: record.status,
    source: record.source ?? "manual",
    reason: record.reason ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    details: record.details ?? {},
  };
}

async function maybeNotifyPipelineStatus(record, previousStatus) {
  const clientId = String(record?.details?.clientId ?? "").trim();
  if (!clientId || !record?.status || record.status === "review") {
    return record;
  }

  if (record.notifiedStatus === record.status) {
    return record;
  }

  if (previousStatus === record.status && record.notifiedStatus) {
    return record;
  }

  const approved = record.status === "approved";
  const kind = approved ? "pipeline-approved" : "pipeline-rejected";
  const title = approved ? "Your place was approved" : "Your place was rejected";
  const body = approved
    ? `${record.requestedName} was approved and added to the dictionary.`
    : `${record.requestedName} was rejected by the pipeline.`;

  await enqueueNotification({
    clientId,
    kind,
    title,
    body,
    targetUrl: "/pipeline",
    sourceType: "place-pipeline",
    sourceId: record.id,
  });

  return { ...record, notifiedStatus: record.status };
}

function recordKey(record) {
  return String(record?.requestedKey ?? record?.requestedName ?? record?.id ?? "").toLowerCase();
}

function mergeRecords(primary, secondary) {
  const merged = new Map();
  for (const record of [...secondary, ...primary]) {
    const key = recordKey(record);
    if (!key) continue;
    merged.set(key, record);
  }
  return [...merged.values()];
}

function buildStatus(records) {
  const openRequests = records.filter((record) => record.status === "review").map(publicRecord);
  const approvedCountries = records.filter((record) => record.status === "approved").map(publicRecord);
  const rejectedRequests = records.filter((record) => record.status === "rejected").map(publicRecord);
  const needsReview = openRequests;
  const updatedAt = records.reduce((latest, record) => {
    if (!record.updatedAt) return latest;
    if (!latest) return record.updatedAt;
    return record.updatedAt > latest ? record.updatedAt : latest;
  }, null);

  return {
    updatedAt,
    source: "redis",
    endpoint: "/api/place-pipeline",
    dictionaryVersion:
      approvedCountries.reduce((latest, record) => {
        if (!record.updatedAt) return latest;
        if (!latest) return record.updatedAt;
        return record.updatedAt > latest ? record.updatedAt : latest;
      }, null) ?? PLACE_DICTIONARY_VERSION ?? readDictionaryVersion(),
    openRequests,
    approvedCountries,
    rejectedRequests,
    needsReview,
    totals: {
      open: openRequests.length,
      approved: approvedCountries.length,
      rejected: rejectedRequests.length,
      review: needsReview.length,
    },
  };
}

async function loadRecordsFromRedis() {
  const ids = await redisCmd("ZREVRANGE", REQUESTS_KEY, "0", "-1");
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const rawRecords = await redisPipeline(ids.map((id) => ["GET", `${PIPELINE_PREFIX}req:${id}`]));
  return rawRecords.map((record) => safeJsonParse(record)).filter((record) => record && typeof record === "object");
}

async function resolveCountry(requestedName) {
  const response = await fetch(`https://restcountries.com/v3.1/name/${encodeURIComponent(requestedName)}`);
  if (!response.ok) return null;
  const data = await response.json();
  if (!Array.isArray(data)) return null;
  const requestedKey = normalize(requestedName);
  for (const item of data) {
    const common = String(item?.name?.common ?? "").trim();
    const official = String(item?.name?.official ?? "").trim();
    const altSpellings = Array.isArray(item?.altSpellings) ? item.altSpellings : [];
    const candidateNames = [common, official, ...altSpellings].filter(Boolean);
    if (candidateNames.some((name) => normalize(name) === requestedKey)) {
      return { canonicalName: common || official || requestedName, source: "restcountries", reason: "Auto-approved as a country." };
    }
  }
  return null;
}

const PLACE_DESC_KEYWORDS = [
  "district", "city", "town", "village", "municipality", "county", "province", "state", "region",
  "country", "territory", "island", "river", "lake", "mountain", "bay", "gulf", "strait", "channel", "peninsula",
  "cape", "valley", "forest", "desert", "park", "reservoir", "reef", "plain", "plateau", "suburb",
];
const NON_PLACE_DESC_KEYWORDS = [
  "company", "business", "organization", "organisation", "corporation", "brand", "film", "song",
  "album", "book", "television series", "actor", "singer", "software", "tech company",
];

async function resolveWebPlace(requestedName) {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(requestedName)}&language=en&format=json&origin=*`;
  const response = await fetch(url, { headers: { "User-Agent": "Atlas Junior place pipeline" } });
  if (!response.ok) return null;
  const data = await response.json();
  const results = Array.isArray(data?.search) ? data.search : [];
  for (const result of results) {
    const label = String(result?.label ?? "").trim();
    const description = String(result?.description ?? "").toLowerCase();
    if (!label) continue;
    if (NON_PLACE_DESC_KEYWORDS.some((keyword) => description.includes(keyword))) {
      return {
        status: "rejected",
        source: "wikidata",
        reason: `Web lookup found a non-place entry (${description || "no description"}).`,
      };
    }
    if (PLACE_DESC_KEYWORDS.some((keyword) => description.includes(keyword))) {
      return {
        status: "approved",
        canonicalName: label,
        source: "wikidata",
        reason: `Auto-approved by web lookup (${description || "place-like result"}).`,
      };
    }
  }
  return { status: "rejected", source: "wikidata", reason: "Web lookup did not identify this as a place." };
}

async function classifyRequestedName(requestedName) {
  const country = await resolveCountry(requestedName);
  if (country) {
    return { status: "approved", canonicalName: country.canonicalName, source: country.source, reason: country.reason };
  }
  const webPlace = await resolveWebPlace(requestedName);
  if (webPlace) return webPlace;
  return { status: "rejected", reason: "Web lookup did not identify this as a place." };
}

function extractRequestedName(body) {
  const explicit = String(body?.requestedName ?? body?.place ?? "").trim();
  if (explicit) return explicit;
  const title = String(body?.title ?? "").trim();
  const titleMatch = title.match(/^Add place request:\s*(.+)$/i);
  if (titleMatch?.[1]) return titleMatch[1].trim();
  const freeText = String(body?.body ?? "").trim();
  const bodyMatch = freeText.match(/Please add\s+"([^"]+)"/i);
  if (bodyMatch?.[1]) return bodyMatch[1].trim();
  return "";
}

async function reviewRecord(record) {
  if (!record) {
    return record;
  }

  const previousStatus = record.status;
  if (record.status === "review" || record.status === "pending") {
    const classification = await classifyRequestedName(record.requestedName);
    const now = new Date().toISOString();
    record = {
      ...record,
      canonicalName: classification.canonicalName ?? record.canonicalName ?? null,
      status: classification.status,
      source: classification.source ?? record.source ?? "manual",
      reason: classification.reason ?? record.reason ?? null,
      updatedAt: now,
    };
  }

  return maybeNotifyPipelineStatus(record, previousStatus);
}

async function persistReviewedRecords(records) {
  const commands = [];
  for (const record of records) {
    commands.push(["SET", `${PIPELINE_PREFIX}req:${record.id}`, JSON.stringify(record)]);
  }
  if (commands.length > 0) {
    await redisPipeline(commands);
  }
}

async function loadAndReviewRecords() {
  const liveRecords = await loadRecordsFromRedis();
  const fallback = readFallbackStatus();
  const fallbackRecords = [
    ...(Array.isArray(fallback.openRequests) ? fallback.openRequests : []),
    ...(Array.isArray(fallback.approvedCountries) ? fallback.approvedCountries : []),
    ...(Array.isArray(fallback.rejectedRequests) ? fallback.rejectedRequests : []),
    ...(Array.isArray(fallback.needsReview) ? fallback.needsReview : []),
  ];

  const merged = mergeRecords(liveRecords, fallbackRecords);
  const reviewed = [];
  for (const record of merged) {
    reviewed.push(await reviewRecord(record));
  }
  await persistReviewedRecords(reviewed.filter((record) => record && record.status !== "pending"));
  return reviewed;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    try {
      return res.json(buildStatus(await loadAndReviewRecords()));
    } catch (err) {
      console.error("GET /place-pipeline", err);
      return res.status(500).json({ error: "Could not load place pipeline" });
    }
  }

  if (req.method === "POST") {
    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
      return res.status(503).json({ error: "Pipeline storage is unavailable" });
    }

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
    const rateKey = `${RATE_LIMIT_PREFIX}${ip}`;

    try {
      const [count] = await Promise.all([
        redisCmd("INCR", rateKey),
        redisCmd("EXPIRE", rateKey, String(RATE_WINDOW_SEC)),
      ]);
      if (Number(count) > RATE_LIMIT) {
        return res.status(429).json({ error: "Please wait a few minutes before adding another place." });
      }
    } catch (err) {
      console.error("POST /place-pipeline rate limit", err);
      return res.status(503).json({ error: "Could not verify request rate limit. Please try again shortly." });
    }

    const body = req.body ?? {};
    const requestedName = extractRequestedName(body);
    if (!requestedName) return res.status(400).json({ error: "requestedName is required" });
    const requestedKey = normalize(requestedName);
    if (!requestedKey) return res.status(400).json({ error: "requestedName is required" });

    const existingId = await redisCmd("HGET", `${PIPELINE_PREFIX}index`, requestedKey);
    if (existingId) {
      const existingRaw = await redisCmd("GET", `${PIPELINE_PREFIX}req:${existingId}`);
      const existing = safeJsonParse(existingRaw);
      if (existing) {
        return res.status(200).json({
          requestId: existing.id,
          status: existing.status,
          canonicalName: existing.canonicalName ?? null,
          deduped: true,
          message:
            existing.status === "approved"
              ? `"${existing.requestedName}" is already in the dictionary.`
              : `"${existing.requestedName}" is already in the pipeline.`,
        });
      }
    }

    const createdAt = new Date().toISOString();
    const classification = await classifyRequestedName(requestedName);
    const id = randomUUID();
    const details = {
      playerName: String(body.playerName ?? "").trim(),
      turnLetter: String(body.turnLetter ?? "").trim(),
      platform: String(body.platform ?? "").trim(),
      appVersion: String(body.appVersion ?? "").trim(),
      clientId: String(body.clientId ?? "").trim(),
      savedTurns: Number(body.savedTurns ?? 0),
      totalTurns: Number(body.totalTurns ?? 0),
      suggestion: String(body.suggestion ?? "").trim(),
    };

    const record = {
      id,
      requestedName,
      requestedKey,
      canonicalName: classification.canonicalName ?? null,
      status: classification.status,
      source: classification.source ?? "manual",
      reason: classification.reason ?? null,
      createdAt,
      updatedAt: createdAt,
      details,
    };

    try {
      await redisPipeline([
        ["ZADD", REQUESTS_KEY, String(Date.now()), id],
        ["SET", `${PIPELINE_PREFIX}req:${id}`, JSON.stringify(record)],
        ["HSET", `${PIPELINE_PREFIX}index`, requestedKey, id],
      ]);
      if (record.status !== "review") {
        await maybeNotifyPipelineStatus(record, null).catch((error) =>
          console.error("notify place pipeline", error),
        );
        if (record.status === "approved") {
          await redisPipeline([
            ["ZADD", `${PIPELINE_PREFIX}approved`, String(Date.parse(record.updatedAt) || Date.now()), record.id],
            ["SET", `${PIPELINE_PREFIX}approved:${record.id}`, JSON.stringify({
              id: record.id,
              requestedName: record.requestedName,
              requestedKey: record.requestedKey,
              canonicalName: record.canonicalName ?? null,
              status: record.status,
              source: record.source ?? "manual",
              reason: record.reason ?? null,
              createdAt: record.createdAt,
              updatedAt: record.updatedAt,
              details: record.details ?? {},
            })],
          ]);
        }
        await redisCmd(
          "SET",
          `${PIPELINE_PREFIX}req:${id}`,
          JSON.stringify({ ...record, notifiedStatus: record.status }),
        );
      }
      return res.status(201).json({
        requestId: id,
        status: record.status,
        canonicalName: record.canonicalName,
        deduped: false,
        message:
          record.status === "approved"
            ? `"${record.requestedName}" was approved and added to the dictionary.`
            : `"${record.requestedName}" was rejected by web lookup.`,
      });
    } catch (err) {
      console.error("POST /place-pipeline", err);
      return res.status(500).json({ error: "Could not submit place request" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
