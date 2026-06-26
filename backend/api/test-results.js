import { hasRedis, redisCmd, redisPipeline } from "../lib/redis.js";

const HISTORY_LIMIT = 20;
const KEY_LATEST = "atlas:maestro:results:latest";
const KEY_HISTORY = "atlas:maestro:results:history";
const KEY_PREFIX = "atlas:maestro:results:report:";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readReports() {
  if (!hasRedis()) {
    return { latest: null, history: [] };
  }

  const latestRaw = await redisCmd("GET", KEY_LATEST);
  const historyIds = await redisCmd("ZREVRANGE", KEY_HISTORY, 0, HISTORY_LIMIT - 1);
  const history = [];

  for (const id of historyIds || []) {
    const raw = await redisCmd("GET", `${KEY_PREFIX}${id}`);
    if (!raw) {
      continue;
    }

    try {
      history.push(JSON.parse(raw));
    } catch {
      continue;
    }
  }

  let latest = null;
  if (latestRaw) {
    try {
      latest = JSON.parse(latestRaw);
    } catch {
      latest = null;
    }
  }

  return { latest, history };
}

module.exports = async (req, res) => {
  try {
    setCors(res);

    if (req.method === "OPTIONS") {
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET") {
      return json(res, 200, await readReports());
    }

    if (req.method === "POST") {
      if (!hasRedis()) {
        return json(res, 503, { error: "Redis is unavailable" });
      }

      const body = req.body ?? {};
      if (typeof body.buildVersion !== "string" || !body.buildVersion.trim()) {
        return json(res, 400, { error: "buildVersion is required" });
      }

      if (typeof body.startedAt !== "string" || !body.startedAt.trim()) {
        return json(res, 400, { error: "startedAt is required" });
      }

      if (typeof body.finishedAt !== "string" || !body.finishedAt.trim()) {
        return json(res, 400, { error: "finishedAt is required" });
      }

      if (
        typeof body.passed !== "number" ||
        typeof body.failed !== "number" ||
        !Array.isArray(body.steps)
      ) {
        return json(res, 400, { error: "Invalid Maestro report" });
      }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const report = {
        id,
        appId: typeof body.appId === "string" && body.appId.trim() ? body.appId.trim() : "atlas",
        buildVersion: body.buildVersion.trim(),
        suiteName: typeof body.suiteName === "string" && body.suiteName.trim() ? body.suiteName.trim() : "local-harness",
        platform: typeof body.platform === "string" ? body.platform.trim() : "android",
        device: typeof body.device === "string" ? body.device.trim() : "",
        startedAt: body.startedAt,
        finishedAt: body.finishedAt,
        passed: body.passed,
        failed: body.failed,
        steps: body.steps,
        raw: typeof body.raw === "string" ? body.raw : "",
      };

      await redisPipeline([
        ["set", KEY_LATEST, JSON.stringify(report)],
        ["set", `${KEY_PREFIX}${id}`, JSON.stringify(report)],
        ["zadd", KEY_HISTORY, String(Date.now()), id],
        ["zremrangebyrank", KEY_HISTORY, "0", String(-(HISTORY_LIMIT + 1))],
      ]);

      return json(res, 200, await readReports());
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
};
