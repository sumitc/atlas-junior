import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const PIPELINE_PREFIX = "atlas:place-pipeline:";
const REQUESTS_KEY = `${PIPELINE_PREFIX}requests`;
const REQUEST_INDEX_KEY = `${PIPELINE_PREFIX}index`;
const APPROVED_KEY = `${PIPELINE_PREFIX}approved`;
const RATE_LIMIT_PREFIX = `${PIPELINE_PREFIX}ratelimit:`;
const RATE_LIMIT = 1;
const RATE_WINDOW_SEC = 300;
const FALLBACK_STATUS_FILE = join(process.cwd(), "data", "place-pipeline-status.json");

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

function readFallbackStatus() {
  if (!existsSync(FALLBACK_STATUS_FILE)) {
    return {
      updatedAt: null,
      source: "redis",
      endpoint: "/api/place-pipeline",
      openRequests: [],
      approvedCountries: [],
      needsReview: [],
      totals: { open: 0, approved: 0, review: 0 },
    };
  }

  try {
    return JSON.parse(readFileSync(FALLBACK_STATUS_FILE, "utf8"));
  } catch {
    return {
      updatedAt: null,
      source: "redis",
      endpoint: "/api/place-pipeline",
      openRequests: [],
      approvedCountries: [],
      needsReview: [],
      totals: { open: 0, approved: 0, review: 0 },
    };
  }
}

async function redisCmd(...args) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    throw new Error("Redis env vars are missing");
  }

  const res = await fetch(`${UPSTASH_URL}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

async function redisPipeline(commands) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    throw new Error("Redis env vars are missing");
  }

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
  const openRequests = records
    .filter((record) => record.status !== "approved")
    .map(publicRecord);
  const approvedCountries = records
    .filter((record) => record.status === "approved")
    .map(publicRecord);
  const needsReview = records
    .filter((record) => record.status === "review")
    .map(publicRecord);

  const updatedAt = records.reduce((latest, record) => {
    if (!record.updatedAt) return latest;
    if (!latest) return record.updatedAt;
    return record.updatedAt > latest ? record.updatedAt : latest;
  }, null);

  return {
    updatedAt,
    source: "redis",
    endpoint: "/api/place-pipeline",
    openRequests,
    approvedCountries,
    needsReview,
    totals: {
      open: openRequests.length,
      approved: approvedCountries.length,
      review: needsReview.length,
    },
  };
}

async function loadRecordsFromRedis() {
  const ids = await redisCmd("ZREVRANGE", REQUESTS_KEY, "0", "-1");
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }

  const rawRecords = await redisPipeline(ids.map((id) => ["GET", `${PIPELINE_PREFIX}req:${id}`]));
  return rawRecords
    .map((record) => safeJsonParse(record))
    .filter((record) => record && typeof record === "object");
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
      return {
        canonicalName: common || official || requestedName,
        source: "restcountries",
      };
    }
  }

  return null;
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

async function loadStatus() {
  try {
    const liveRecords = await loadRecordsFromRedis();
    const fallback = readFallbackStatus();
    const fallbackRecords = [
      ...(Array.isArray(fallback.openRequests) ? fallback.openRequests : []),
      ...(Array.isArray(fallback.approvedCountries) ? fallback.approvedCountries : []),
      ...(Array.isArray(fallback.needsReview) ? fallback.needsReview : []),
    ];

    return buildStatus(mergeRecords(liveRecords, fallbackRecords));
  } catch {
    return readFallbackStatus();
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    try {
      return res.json(await loadStatus());
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

    if (!requestedName) {
      return res.status(400).json({ error: "requestedName is required" });
    }

    const requestedKey = normalize(requestedName);
    if (!requestedKey) {
      return res.status(400).json({ error: "requestedName is required" });
    }

    const existingId = await redisCmd("HGET", REQUEST_INDEX_KEY, requestedKey);
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
    const match = await resolveCountry(requestedName);
    const id = randomUUID();
    const details = {
      playerName: String(body.playerName ?? "").trim(),
      turnLetter: String(body.turnLetter ?? "").trim(),
      platform: String(body.platform ?? "").trim(),
      appVersion: String(body.appVersion ?? "").trim(),
      savedTurns: Number(body.savedTurns ?? 0),
      totalTurns: Number(body.totalTurns ?? 0),
      suggestion: String(body.suggestion ?? "").trim(),
    };

    const record = {
      id,
      requestedName,
      requestedKey,
      canonicalName: match?.canonicalName ?? null,
      status: match ? "approved" : "review",
      source: match?.source ?? "manual",
      reason: match ? "Auto-approved as current country." : "Queued for review.",
      createdAt,
      updatedAt: createdAt,
      details,
    };

    const commands = [
      ["ZADD", REQUESTS_KEY, String(Date.now()), id],
      ["SET", `${PIPELINE_PREFIX}req:${id}`, JSON.stringify(record)],
      ["HSET", REQUEST_INDEX_KEY, requestedKey, id],
    ];

    if (match) {
      commands.push([
        "HSET",
        APPROVED_KEY,
        requestedKey,
        JSON.stringify({
          requestedName,
          canonicalName: match.canonicalName,
          source: match.source,
          updatedAt: createdAt,
        }),
      ]);
    }

    try {
      await redisPipeline(commands);
      return res.status(201).json({
        requestId: id,
        status: record.status,
        canonicalName: record.canonicalName,
        deduped: false,
        message:
          record.status === "approved"
            ? `"${record.requestedName}" was added to the dictionary as ${record.canonicalName}.`
            : `"${record.requestedName}" was queued for review.`,
      });
    } catch (err) {
      console.error("POST /place-pipeline", err);
      return res.status(500).json({ error: "Could not submit place request" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
