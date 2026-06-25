import { PLACE_DICTIONARY_VERSION } from "./place-dictionary-version.js";
import { hasRedis, redisCmd, redisPipeline } from "../lib/redis.js";

const PIPELINE_PREFIX = "atlas:place-pipeline:";
const APPROVED_INDEX_KEY = `${PIPELINE_PREFIX}approved`;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

async function loadDeltaRecords(since) {
  if (!hasRedis()) {
    return [];
  }

  const sinceTime = Number.isFinite(Date.parse(since)) ? Date.parse(since) : Date.parse(PLACE_DICTIONARY_VERSION);
  const ids = await redisCmd("ZRANGEBYSCORE", APPROVED_INDEX_KEY, String(sinceTime || 0), "+inf");
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }

  const rows = await redisPipeline(ids.map((id) => ["GET", `${PIPELINE_PREFIX}approved:${id}`]));
  return rows
    .map((row) => {
      if (typeof row !== "string" || !row) {
        return null;
      }
      try {
        return JSON.parse(row);
      } catch {
        return null;
      }
    })
    .filter((row) => row && typeof row === "object");
}

function toDictionaryEntry(record) {
  const requestedName = String(record?.requestedName ?? "").trim();
  const canonicalName = String(record?.canonicalName ?? "").trim();
  const requestedKey = normalize(record?.requestedKey ?? requestedName);
  const canonicalKey = normalize(canonicalName);
  const updatedAt = String(record?.updatedAt ?? "").trim();

  if (!requestedName || !canonicalName || !requestedKey || !updatedAt) {
    return null;
  }

  return {
    requestedName,
    canonicalName,
    requestedKey,
    canonicalKey: canonicalKey || null,
    updatedAt,
    source: String(record?.source ?? "manual").trim() || "manual",
    reason: String(record?.reason ?? "").trim() || null,
  };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const since = String(req.query?.since ?? "").trim();
    const records = await loadDeltaRecords(since);
    const items = records
      .filter((record) => record?.status === "approved")
      .map(toDictionaryEntry)
      .filter(Boolean);

    const version = items.reduce((latest, item) => {
      if (!item?.updatedAt) return latest;
      if (!latest) return item.updatedAt;
      return item.updatedAt > latest ? item.updatedAt : latest;
    }, null) ?? PLACE_DICTIONARY_VERSION;

    return res.status(200).json({
      version,
      since: since || PLACE_DICTIONARY_VERSION,
      items,
    });
  } catch (err) {
    console.error("GET /place-dictionary-delta", err);
    return res.status(500).json({ error: "Could not load dictionary delta" });
  }
}
