import { randomUUID } from "crypto";
import { hasRedis, redisCmd, redisPipeline } from "./redis.js";
import { sendMulticastPush } from "./fcm.js";

const NOTIFICATION_INDEX_PREFIX = "atlas:notifs:";
const NOTIFICATION_ITEM_PREFIX = "atlas:notif:";
const PUSH_CLIENT_PREFIX = "atlas:push:client:";
const PUSH_TOKEN_PREFIX = "atlas:push:token:";
const MAX_NOTIFICATIONS_PER_CLIENT = 50;
const READ_RETENTION_MS = 24 * 60 * 60 * 1000;

function clientIndexKey(clientId) {
  return `${NOTIFICATION_INDEX_PREFIX}${clientId}`;
}

function notificationItemKey(notificationId) {
  return `${NOTIFICATION_ITEM_PREFIX}${notificationId}`;
}

function pushClientKey(clientId) {
  return `${PUSH_CLIENT_PREFIX}${clientId}`;
}

function pushTokenKey(token) {
  return `${PUSH_TOKEN_PREFIX}${token}`;
}

function toNotification(fields) {
  if (!Array.isArray(fields) || fields.length < 10) {
    return null;
  }

  const [id, clientId, kind, title, body, targetUrl, sourceType, sourceId, createdAt, readAt] = fields;
  if (!id || !clientId || !kind || !title || !body || !targetUrl || !sourceType || !sourceId || !createdAt) {
    return null;
  }

  return {
    id,
    clientId,
    kind,
    title,
    body,
    targetUrl,
    sourceType,
    sourceId,
    createdAt,
    readAt: readAt || null,
  };
}

function isNotificationVisible(notification) {
  if (!notification) {
    return false;
  }

  if (!notification.readAt) {
    return true;
  }

  const readAtTime = Date.parse(notification.readAt);
  if (!Number.isFinite(readAtTime)) {
    return true;
  }

  return Date.now() - readAtTime < READ_RETENTION_MS;
}

export async function registerPushDevice(clientId, token, platform) {
  const safeClientId = String(clientId ?? "").trim();
  const safeToken = String(token ?? "").trim();
  if (!hasRedis() || !safeClientId || !safeToken) {
    return false;
  }

  console.info("registerPushDevice", {
    clientId: safeClientId,
    tokenPrefix: safeToken.slice(0, 12),
    platform: String(platform ?? "android"),
  });

  await redisPipeline([
    ["SADD", pushClientKey(safeClientId), safeToken],
    ["HSET", pushTokenKey(safeToken), "clientId", safeClientId, "platform", String(platform ?? "android"), "updatedAt", new Date().toISOString()],
  ]);

  return true;
}

export async function unregisterPushDevice(clientId, token) {
  const safeClientId = String(clientId ?? "").trim();
  const safeToken = String(token ?? "").trim();
  if (!hasRedis() || !safeClientId || !safeToken) {
    return false;
  }

  await redisPipeline([
    ["SREM", pushClientKey(safeClientId), safeToken],
    ["DEL", pushTokenKey(safeToken)],
  ]);

  return true;
}

async function getClientTokens(clientId) {
  const tokens = await redisCmd("SMEMBERS", pushClientKey(clientId));
  return Array.isArray(tokens) ? tokens.filter(Boolean) : [];
}

async function removeInvalidTokens(clientId, tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return;
  }

  await redisPipeline(
    tokens.flatMap((token) => [
      ["SREM", pushClientKey(clientId), token],
      ["DEL", pushTokenKey(token)],
    ]),
  );
}

async function deliverPush(notification) {
  const tokens = await getClientTokens(notification.clientId);
  if (tokens.length === 0) {
    console.info("deliverPush:no-tokens", {
      clientId: notification.clientId,
      notificationId: notification.id,
      kind: notification.kind,
    });
    return;
  }

  const result = await sendMulticastPush({
    tokens,
    title: notification.title,
    body: notification.body,
    data: {
      targetUrl: notification.targetUrl,
      notificationId: notification.id,
      kind: notification.kind,
      sourceType: notification.sourceType,
      sourceId: notification.sourceId,
    },
  });

  console.info("deliverPush:result", {
    clientId: notification.clientId,
    notificationId: notification.id,
    kind: notification.kind,
    tokenCount: tokens.length,
    successCount: result.successCount,
    failureCount: result.failureCount,
  });

  const invalidTokens = [];
  result.responses.forEach((response, index) => {
    if (response?.success) {
      return;
    }

    const message = String(response?.error?.message ?? "");
    if (
      message.includes("registration-token-not-registered") ||
      message.includes("invalid-registration-token")
    ) {
      invalidTokens.push(tokens[index]);
    }
  });

  if (invalidTokens.length > 0) {
    await removeInvalidTokens(notification.clientId, invalidTokens);
  }
}

export async function enqueueNotification(input) {
  const clientId = String(input?.clientId ?? "").trim();
  if (!hasRedis() || !clientId) {
    return null;
  }

  const id = String(input?.id ?? randomUUID());
  const createdAt = input?.createdAt ?? new Date().toISOString();
  const timestamp = String(input?.timestamp ?? (Date.parse(createdAt) || Date.now()));
  const notification = {
    id,
    clientId,
    kind: String(input?.kind ?? "info"),
    title: String(input?.title ?? "").trim() || "Atlas update",
    body: String(input?.body ?? "").trim() || "Something changed in Atlas.",
    targetUrl: String(input?.targetUrl ?? "/"),
    sourceType: String(input?.sourceType ?? "unknown"),
    sourceId: String(input?.sourceId ?? id),
    createdAt,
    readAt: null,
  };

  await redisPipeline([
    [
      "HSET",
      notificationItemKey(id),
      "id",
      notification.id,
      "clientId",
      notification.clientId,
      "kind",
      notification.kind,
      "title",
      notification.title,
      "body",
      notification.body,
      "targetUrl",
      notification.targetUrl,
      "sourceType",
      notification.sourceType,
      "sourceId",
      notification.sourceId,
      "createdAt",
      notification.createdAt,
      "readAt",
      "",
    ],
    ["ZADD", clientIndexKey(clientId), timestamp, id],
    ["ZREMRANGEBYRANK", clientIndexKey(clientId), "0", String(-(MAX_NOTIFICATIONS_PER_CLIENT + 1))],
  ]);

  void deliverPush(notification).catch((error) => {
    console.error("deliver push notification", error);
  });

  return notification;
}

export async function listNotifications(clientId) {
  const safeClientId = String(clientId ?? "").trim();
  if (!hasRedis() || !safeClientId) {
    return { notifications: [], unreadCount: 0 };
  }

  const ids = await redisCmd("ZREVRANGE", clientIndexKey(safeClientId), "0", String(MAX_NOTIFICATIONS_PER_CLIENT - 1));
  if (!Array.isArray(ids) || ids.length === 0) {
    return { notifications: [], unreadCount: 0 };
  }

  const rows = await redisPipeline(
    ids.map((id) => [
      "HMGET",
      notificationItemKey(id),
      "id",
      "clientId",
      "kind",
      "title",
      "body",
      "targetUrl",
      "sourceType",
      "sourceId",
      "createdAt",
      "readAt",
    ]),
  );

  const notifications = rows.map(toNotification).filter(Boolean);
  const visibleNotifications = notifications.filter(isNotificationVisible);
  const unreadCount = visibleNotifications.reduce((count, item) => count + (item.readAt ? 0 : 1), 0);

  return { notifications: visibleNotifications, unreadCount };
}

export async function markNotificationsRead(clientId, notificationIds = []) {
  const safeClientId = String(clientId ?? "").trim();
  if (!hasRedis() || !safeClientId) {
    return { notifications: [], unreadCount: 0 };
  }

  const ids =
    Array.isArray(notificationIds) && notificationIds.length > 0
      ? notificationIds.map((id) => String(id).trim()).filter(Boolean)
      : (await listNotifications(safeClientId)).notifications.map((item) => item.id);

  if (ids.length === 0) {
    return { notifications: [], unreadCount: 0 };
  }

  const readAt = new Date().toISOString();
  await redisPipeline(
    ids.map((id) => ["HSET", notificationItemKey(id), "readAt", readAt]),
  );

  return listNotifications(safeClientId);
}
