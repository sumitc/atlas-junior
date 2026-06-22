import { listNotifications, markNotificationsRead } from "../lib/notifications.js";

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
      const clientId = String(req.query?.clientId ?? req.body?.clientId ?? "").trim();
      if (!clientId) {
        return res.status(400).json({ error: "clientId is required" });
      }

      return res.json(await listNotifications(clientId));
    } catch (error) {
      console.error("GET /notifications", error);
      return res.status(500).json({ error: "Could not load notifications" });
    }
  }

  if (req.method === "POST") {
    try {
      const { clientId, notificationIds } = req.body ?? {};
      const safeClientId = String(clientId ?? "").trim();
      if (!safeClientId) {
        return res.status(400).json({ error: "clientId is required" });
      }

      return res.json(await markNotificationsRead(safeClientId, notificationIds));
    } catch (error) {
      console.error("POST /notifications", error);
      return res.status(500).json({ error: "Could not update notifications" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
