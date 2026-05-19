import { randomUUID } from "crypto";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const LB_KEY = "atlas:leaderboard";
const MAX_SCORE = 9_999;
const TOP_N = 10;
const MAX_STORED = 50; // store more than displayed so ties don't get lost

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function redisCmd(...args) {
  const res = await fetch(`${UPSTASH_URL}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

async function redisPipeline(commands) {
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
  return json.map((r) => r.result);
}

function localDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    try {
      const raw = await redisCmd("ZREVRANGE", LB_KEY, "0", String(TOP_N - 1), "WITHSCORES");
      if (!raw || raw.length === 0) return res.json({ entries: [] });

      const ids = [];
      const scores = [];
      for (let i = 0; i < raw.length; i += 2) {
        ids.push(raw[i]);
        scores.push(Number(raw[i + 1]));
      }

      const pipeline = ids.map((id) => ["HGETALL", `atlas:lb:${id}`]);
      const metaArr = await redisPipeline(pipeline);

      const entries = ids.map((id, i) => {
        const meta = metaArr[i] || {};
        return { id, name: meta.name ?? "Anonymous", score: scores[i], date: meta.date ?? "", rank: i + 1 };
      });

      return res.json({ entries });
    } catch (err) {
      console.error("GET /leaderboard", err);
      return res.status(500).json({ error: "Could not fetch leaderboard" });
    }
  }

  if (req.method === "POST") {
    const { name, score, date } = req.body ?? {};

    const safeName = String(name ?? "").trim().slice(0, 24) || "Anonymous";
    const rawScore = Number(score);
    const safeScore = Number.isFinite(rawScore) ? Math.min(Math.max(Math.round(rawScore), 0), MAX_SCORE) : 0;
    const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? "")) ? String(date) : localDateString();
    // Always generate server-side to prevent ID guessing / metadata overwrite
    const id = randomUUID();

    try {
      const [, , , rank] = await redisPipeline([
        ["ZADD", LB_KEY, "NX", String(safeScore), id],
        ["HSET", `atlas:lb:${id}`, "name", safeName, "score", String(safeScore), "date", safeDate],
        ["ZREMRANGEBYRANK", LB_KEY, "0", String(-(MAX_STORED + 1))],
        ["ZREVRANK", LB_KEY, id],
      ]);

      const finalRank = rank !== null ? Number(rank) + 1 : null;
      return res.json({ entryId: id, rank: finalRank, onLeaderboard: finalRank !== null && finalRank <= TOP_N });
    } catch (err) {
      console.error("POST /leaderboard", err);
      return res.status(500).json({ error: "Could not save score" });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
