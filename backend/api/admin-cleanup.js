// ONE-TIME cleanup route — delete after use
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const LB_KEY = "atlas:leaderboard";

async function redisPipeline(commands) {
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  const json = await res.json();
  return json.map((r) => r.result);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).end();

  const { ids, secret } = req.body ?? {};
  if (secret !== process.env.CLEANUP_SECRET) return res.status(403).json({ error: "forbidden" });
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids required" });

  const cmds = [
    ["ZREM", LB_KEY, ...ids],
    ...ids.map((id) => ["DEL", `atlas:lb:${id}`]),
  ];
  const results = await redisPipeline(cmds);
  res.json({ removed: results[0], deleted: results.slice(1) });
}
