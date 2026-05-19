const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisCmd(...args) {
  const res = await fetch(`${UPSTASH_URL}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    try {
      const [games, turns] = await Promise.all([
        redisCmd("GET", "atlas:stats:games"),
        redisCmd("GET", "atlas:stats:turns"),
      ]);
      return res.json({ games: Number(games ?? 0), turns: Number(turns ?? 0) });
    } catch (err) {
      console.error("GET /stats", err);
      return res.status(500).json({ error: "Could not fetch stats" });
    }
  }

  if (req.method === "POST") {
    const { turns } = req.body ?? {};
    const safeTurns = Math.max(0, Math.round(Number(turns ?? 0)));
    try {
      await Promise.all([
        redisCmd("INCR", "atlas:stats:games"),
        safeTurns > 0 ? redisCmd("INCRBY", "atlas:stats:turns", String(safeTurns)) : Promise.resolve(),
      ]);
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("POST /stats", err);
      return res.status(500).json({ error: "Could not save stats" });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
