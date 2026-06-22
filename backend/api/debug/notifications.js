import { enqueueNotification } from "../../lib/notifications.js";
import { redisCmd } from "../../lib/redis.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function buildTestNotification(kind) {
  switch (kind) {
    case "leaderboard-top":
      return {
        kind,
        title: "You're #1 on Atlas",
        body: "Your score of 99 turns is now the top score.",
        targetUrl: "/leaderboard",
        sourceType: "leaderboard",
        sourceId: `debug-${kind}`,
      };
    case "leaderboard-toppled":
      return {
        kind,
        title: "Your top score was topped",
        body: "Debug Rival just moved ahead with 88 turns.",
        targetUrl: "/leaderboard",
        sourceType: "leaderboard",
        sourceId: `debug-${kind}`,
      };
    case "pipeline-approved":
      return {
        kind,
        title: "Your place was approved",
        body: "Debug Place was approved and added to the dictionary.",
        targetUrl: "/pipeline",
        sourceType: "place-pipeline",
        sourceId: `debug-${kind}`,
      };
    case "pipeline-rejected":
      return {
        kind,
        title: "Your place was rejected",
        body: "Debug Place was rejected by the pipeline.",
        targetUrl: "/pipeline",
        sourceType: "place-pipeline",
        sourceId: `debug-${kind}`,
      };
    case "support-updated":
      return {
        kind,
        title: "Support ticket #42 updated",
        body: "Debug ticket received a new update on GitHub.",
        targetUrl: "/support",
        sourceType: "support-ticket",
        sourceId: `debug-${kind}`,
      };
    case "support-closed":
      return {
        kind,
        title: "Support ticket #42 resolved",
        body: "Debug ticket was marked as resolved on GitHub.",
        targetUrl: "/support",
        sourceType: "support-ticket",
        sourceId: `debug-${kind}`,
      };
    default:
      return null;
  }
}

async function listRegisteredClientIds() {
  const clientIds = new Set();
  let cursor = "0";

  do {
    const result = await redisCmd("SCAN", cursor, "MATCH", "atlas:push:client:*", "COUNT", "100");
    if (!Array.isArray(result) || result.length < 2) {
      break;
    }

    cursor = String(result[0] ?? "0");
    const keys = Array.isArray(result[1]) ? result[1] : [];
    for (const key of keys) {
      const match = String(key ?? "").match(/^atlas:push:client:(.+)$/);
      if (match?.[1]) {
        clientIds.add(match[1]);
      }
    }
  } while (cursor !== "0");

  return [...clientIds];
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const clientId = String(req.body?.clientId ?? "").trim();
    const kind = String(req.body?.kind ?? "").trim();

    const spec = buildTestNotification(kind);
    if (!spec) {
      return res.status(400).json({ error: "Unknown debug notification kind" });
    }

    const targetClientIds = clientId ? [clientId] : await listRegisteredClientIds();
    if (targetClientIds.length === 0) {
      return res.status(503).json({ error: "No registered devices are available for test notifications" });
    }

    const notifications = [];
    for (const targetClientId of targetClientIds) {
      const notification = await enqueueNotification({
        clientId: targetClientId,
        ...spec,
      });
      if (notification) {
        notifications.push(notification);
      }
    }

    return res.status(201).json({
      notifications,
      deliveredTo: targetClientIds.length,
    });
  } catch (error) {
    console.error("POST /debug/notifications", error);
    return res.status(500).json({ error: "Could not send test notification" });
  }
}
