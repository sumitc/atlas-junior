const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || "sumitc/atlas-junior";
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
const VALID_TYPES = { bug: "bug", feature: "enhancement" };
const RATE_KEY_PREFIX = "atlas:ratelimit:tickets:";
const RATE_LIMIT = 1;
const RATE_WINDOW_SEC = 900; // 15 min

async function redisCmd(...args) {
  const res = await fetch(`${UPSTASH_URL}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    try {
      const [openRes, closedRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues?labels=atlas-app&state=open&per_page=30`, {
          headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        }),
        fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues?labels=atlas-app&state=closed&per_page=30&sort=updated&direction=desc`, {
          headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        }),
      ]);
      if (!openRes.ok) throw new Error(`GitHub ${openRes.status}`);
      if (!closedRes.ok) throw new Error(`GitHub ${closedRes.status}`);

      const toIssue = (i) => ({
        number: i.number,
        title: i.title,
        url: i.html_url,
        state: i.state,
        labels: i.labels.map((l) => l.name),
        createdAt: i.created_at,
        closedAt: i.closed_at ?? null,
      });

      const open = (await openRes.json()).filter((i) => !i.pull_request).map(toIssue);
      const closed = (await closedRes.json()).filter((i) => !i.pull_request).map(toIssue);

      return res.json({ issues: open, resolved: closed });
    } catch (err) {
      console.error("GET /tickets", err);
      return res.status(500).json({ error: "Could not fetch tickets" });
    }
  }

  if (req.method === "POST") {
    // IP-based rate limiting via Upstash
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
    const rateKey = `${RATE_KEY_PREFIX}${ip}`;
    try {
      // Run INCR and EXPIRE in parallel — always set TTL so key never persists forever
      // if EXPIRE failed on a prior request (transient Upstash error).
      const [count] = await Promise.all([
        redisCmd("INCR", rateKey),
        redisCmd("EXPIRE", rateKey, String(RATE_WINDOW_SEC)),
      ]);
      if (Number(count) > RATE_LIMIT) {
        return res.status(429).json({ error: "Too many tickets submitted. Please wait a few minutes." });
      }
    } catch {
      return res.status(503).json({ error: "Could not verify rate limit. Please try again shortly." });
    }

    const { title, body, type } = req.body ?? {};
    const safeTitle = String(title ?? "").trim().slice(0, 256);
    const safeBody = String(body ?? "").trim().slice(0, 4096);
    const labelType = VALID_TYPES[type] ?? "enhancement";

    if (!safeTitle) return res.status(400).json({ error: "Title is required" });

    try {
      const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: safeTitle, body: safeBody || undefined, labels: ["atlas-app", labelType] }),
      });
      if (!ghRes.ok) {
        const err = await ghRes.json().catch(() => ({}));
        throw new Error(err.message ?? `GitHub ${ghRes.status}`);
      }
      const issue = await ghRes.json();
      return res.status(201).json({ number: issue.number, url: issue.html_url });
    } catch (err) {
      console.error("POST /tickets", err);
      return res.status(500).json({ error: "Could not submit ticket" });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}
