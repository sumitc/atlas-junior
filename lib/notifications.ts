export type AppNotification = {
  id: string;
  clientId: string;
  kind: string;
  title: string;
  body: string;
  targetUrl: string;
  sourceType: string;
  sourceId: string;
  createdAt: string;
  readAt: string | null;
};

export type NotificationInbox = {
  notifications: AppNotification[];
  unreadCount: number;
};

export function resolveNotificationTargetUrl(input: {
  kind?: string;
  targetUrl?: string;
}): string {
  const targetUrl = String(input?.targetUrl ?? "").trim();
  if (targetUrl) {
    return targetUrl;
  }

  const kind = String(input?.kind ?? "").trim();
  if (kind.includes("top") || kind.includes("leaderboard")) {
    return "/leaderboard";
  }

  if (kind.includes("pipeline")) {
    return "/pipeline";
  }

  if (kind.includes("support")) {
    return "/support";
  }

  return "/";
}
