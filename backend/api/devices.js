import { redisPipeline } from "../lib/redis.js";

const DEVICE_INDEX_PREFIX = "atlas:push:client:";
const TOKEN_META_PREFIX = "atlas:push:token:";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function clientSetKey(clientId) {
  return `${DEVICE_INDEX_PREFIX}${clientId}`;
}

function tokenMetaKey(token) {
  return `${TOKEN_META_PREFIX}${token}`;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { clientId, token, platform } = req.body ?? {};
    const safeClientId = String(clientId ?? "").trim();
    const safeToken = String(token ?? "").trim();
    const safePlatform = String(platform ?? "").trim() || "android";

    if (!safeClientId || !safeToken) {
      return res.status(400).json({ error: "clientId and token are required" });
    }

    if (req.method === "DELETE") {
      await redisPipeline([
        ["SREM", clientSetKey(safeClientId), safeToken],
        ["DEL", tokenMetaKey(safeToken)],
      ]);
      return res.json({ ok: true });
    }

    await redisPipeline([
      ["SADD", clientSetKey(safeClientId), safeToken],
      ["HSET", tokenMetaKey(safeToken), "clientId", safeClientId, "platform", safePlatform, "updatedAt", new Date().toISOString()],
    ]);

    return res.status(201).json({ ok: true });
  } catch (error) {
    console.error("POST /devices", error);
    return res.status(500).json({ error: "Could not register device" });
  }
}
