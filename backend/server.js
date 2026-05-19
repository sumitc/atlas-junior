import express from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "crypto";

const app = express();
const PORT = process.env.PORT || 3001;

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || "sumitc/atlas-junior";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:3000";

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow no-origin (native app / curl) and the configured frontend origin
      const allowed = [ALLOWED_ORIGIN, "http://localhost:3000", "http://localhost:4000"];
      if (!origin || allowed.includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"));
    },
  })
);
app.use(express.json({ limit: "16kb" }));

// ── Upstash Redis helpers ─────────────────────────────────────────────────────

async function redisCmd(...args) {
  const res = await fetch(`${UPSTASH_URL}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

// Pipeline: array of commands → array of results
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
  return json.map((r) => r.result);
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

const LB_KEY = "atlas:leaderboard";
const MAX_SCORE = 9_999;
const TOP_N = 20;
const MAX_STORED = 100;

// GET /leaderboard — top 20 entries with metadata
app.get("/leaderboard", async (req, res) => {
  try {
    // ZREVRANGE with scores → ["id1","15","id2","12",...]
    const raw = await redisCmd("ZREVRANGE", LB_KEY, "0", String(TOP_N - 1), "WITHSCORES");
    if (!raw || raw.length === 0) return res.json({ entries: [] });

    const ids = [];
    const scores = [];
    for (let i = 0; i < raw.length; i += 2) {
      ids.push(raw[i]);
      scores.push(Number(raw[i + 1]));
    }

    // Batch HGETALL for each entry
    const pipeline = ids.map((id) => ["HGETALL", `atlas:lb:${id}`]);
    const metaArr = await redisPipeline(pipeline);

    const entries = ids.map((id, i) => {
      const meta = metaArr[i] || {};
      return {
        id,
        name: meta.name ?? "Anonymous",
        score: scores[i],
        date: meta.date ?? "",
        rank: i + 1,
      };
    });

    res.json({ entries });
  } catch (err) {
    console.error("GET /leaderboard", err);
    res.status(500).json({ error: "Could not fetch leaderboard" });
  }
});

// POST /leaderboard — submit a game score
app.post("/leaderboard", async (req, res) => {
  const { name, score, date, entryId } = req.body ?? {};

  const safeName = String(name ?? "").trim().slice(0, 24) || "Anonymous";
  const safeScore = Math.min(Math.max(Math.round(Number(score)), 1), MAX_SCORE);
  const safeDate = String(date ?? new Date().toISOString().slice(0, 10));
  // Allow client to supply an idempotency key (stable per game); otherwise generate one
  const id = /^[a-z0-9\-]{8,40}$/.test(String(entryId ?? "")) ? entryId : randomUUID();

  try {
    const [added, , rank] = await redisPipeline([
      ["ZADD", LB_KEY, "NX", String(safeScore), id],
      // Store metadata; only written once (NX on ZADD guards idempotency)
      ["HSET", `atlas:lb:${id}`, "name", safeName, "score", String(safeScore), "date", safeDate],
      // Trim to MAX_STORED lowest scores (keeps leaderboard bounded)
      ["ZREMRANGEBYRANK", LB_KEY, "0", String(-(MAX_STORED + 1))],
      ["ZREVRANK", LB_KEY, id],
    ]);

    const finalRank = rank !== null ? Number(rank) + 1 : null;
    res.json({ entryId: id, rank: finalRank, onLeaderboard: finalRank !== null && finalRank <= TOP_N });
  } catch (err) {
    console.error("POST /leaderboard", err);
    res.status(500).json({ error: "Could not save score" });
  }
});

// ── Support Tickets (GitHub Issues) ──────────────────────────────────────────

const ticketsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  message: { error: "Too many tickets submitted. Please wait a few minutes." },
});

const VALID_TYPES = { bug: "bug", feature: "enhancement" };

// GET /tickets — list open issues labelled atlas-app
app.get("/tickets", async (req, res) => {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/issues?labels=atlas-app&state=open&per_page=30`;
    const ghRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!ghRes.ok) throw new Error(`GitHub ${ghRes.status}`);
    const data = await ghRes.json();

    // Filter out any PRs that GitHub includes in the issues list
    const issues = data
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: i.title,
        url: i.html_url,
        state: i.state,
        labels: i.labels.map((l) => l.name),
        createdAt: i.created_at,
      }));

    res.json({ issues });
  } catch (err) {
    console.error("GET /tickets", err);
    res.status(500).json({ error: "Could not fetch tickets" });
  }
});

// POST /tickets — create a new GitHub issue
app.post("/tickets", ticketsLimiter, async (req, res) => {
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
      body: JSON.stringify({
        title: safeTitle,
        body: safeBody || undefined,
        labels: ["atlas-app", labelType],
      }),
    });
    if (!ghRes.ok) {
      const err = await ghRes.json().catch(() => ({}));
      throw new Error(err.message ?? `GitHub ${ghRes.status}`);
    }
    const issue = await ghRes.json();
    res.status(201).json({ number: issue.number, url: issue.html_url });
  } catch (err) {
    console.error("POST /tickets", err);
    res.status(500).json({ error: "Could not submit ticket" });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Atlas API running on :${PORT}`));
