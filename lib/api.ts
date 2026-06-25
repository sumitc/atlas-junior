import { getClientId } from "@/lib/client-id";
import type { NotificationInbox } from "@/lib/notifications";

const BASE =
  process.env.NEXT_PUBLIC_API_URL ??
  (typeof window !== "undefined" ? "http://localhost:3001" : "http://localhost:3001");

// All routes are under /api/ (Vercel serverless functions layout)
const api = (path: string) => `${BASE}/api${path}`;

function attachClientId<T extends Record<string, unknown>>(payload: T): T & { clientId?: string } {
  const clientId = getClientId();
  return clientId ? { ...payload, clientId } : payload;
}

export type LeaderboardEntry = {
  id: string;
  name: string;
  score: number;
  date: string;
  rank: number;
};

export type SubmitResult = {
  entryId: string;
  rank: number | null;
  onLeaderboard: boolean;
};

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const res = await fetch(api("/leaderboard"));
  if (!res.ok) throw new Error("Could not load leaderboard");
  const data = await res.json();
  return data.entries as LeaderboardEntry[];
}

export async function submitScore(params: {
  name: string;
  score: number;
  date: string;
}): Promise<SubmitResult> {
  const res = await fetch(api("/leaderboard"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attachClientId(params)),
  });
  if (!res.ok) throw new Error("Could not save score");
  return res.json();
}

export async function submitStats(turns: number): Promise<void> {
  const res = await fetch(api("/stats"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turns }),
  });
  if (!res.ok) throw new Error("Could not save stats");
}

export async function getStats(): Promise<{ games: number; turns: number }> {
  const res = await fetch(api("/stats"));
  if (!res.ok) throw new Error("Could not load stats");
  return res.json();
}

export type SupportIssue = {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  labels: string[];
  createdAt: string;
  closedAt: string | null;
  updatedAt: string;
  body: string;
};

export async function getTickets(): Promise<{ issues: SupportIssue[]; resolved: SupportIssue[] }> {
  const res = await fetch(api("/tickets"));
  if (!res.ok) throw new Error("Could not load tickets");
  return res.json();
}

export type PlacePipelineStatus = {
  updatedAt: string | null;
  source: string;
  endpoint: string;
  dictionaryVersion: string | null;
  openRequests: PlacePipelineRequest[];
  approvedCountries: PlacePipelineRequest[];
  rejectedRequests: PlacePipelineRequest[];
  needsReview: PlacePipelineRequest[];
  totals: {
    open: number;
    approved: number;
    rejected: number;
    review: number;
  };
};

export type PlaceDictionaryDeltaItem = {
  requestedName: string;
  canonicalName: string;
  requestedKey: string;
  canonicalKey: string | null;
  updatedAt: string;
  source: string;
  reason: string | null;
};

export type PlaceDictionaryDelta = {
  version: string;
  since: string;
  items: PlaceDictionaryDeltaItem[];
};

export type PlacePipelineRequest = {
  id: string;
  requestedName: string;
  requestedKey: string;
  canonicalName: string | null;
  status: "approved" | "review" | "rejected";
  source: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  details: {
    playerName: string;
    turnLetter: string;
    platform: string;
    appVersion: string;
    clientId?: string;
    savedTurns: number;
    totalTurns: number;
    suggestion: string;
  };
};

export async function getPlacePipeline(): Promise<PlacePipelineStatus> {
  const res = await fetch(api("/place-pipeline"));
  if (!res.ok) throw new Error("Could not load place pipeline");
  return res.json();
}

export async function getPlaceDictionaryDelta(since?: string): Promise<PlaceDictionaryDelta> {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  const res = await fetch(api(`/place-dictionary-delta${query}`));
  if (!res.ok) throw new Error("Could not load dictionary delta");
  return res.json();
}

export async function submitPlaceRequest(params: {
  requestedName: string;
  playerName: string;
  turnLetter: string;
  platform: string;
  appVersion: string;
  savedTurns: number;
  totalTurns: number;
  suggestion: string;
}): Promise<{
  requestId: string;
  status: "approved" | "review" | "rejected";
  canonicalName: string | null;
  deduped: boolean;
  message: string;
}> {
  const res = await fetch(api("/place-pipeline"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attachClientId(params)),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Could not submit place request");
  return data;
}

export async function submitTicket(params: {
  title: string;
  body: string;
  type: "bug" | "feature";
}): Promise<{ number: number; url: string }> {
  const res = await fetch(api("/tickets"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attachClientId(params)),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Could not submit ticket");
  return data;
}

export async function registerDeviceToken(params: {
  clientId: string;
  token: string;
  platform: string;
}): Promise<void> {
  const res = await fetch(api("/devices"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Could not register device");
}

export async function unregisterDeviceToken(params: {
  clientId: string;
  token: string;
}): Promise<void> {
  const res = await fetch(api("/devices"), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Could not unregister device");
}

export type AppNotification = NotificationInbox["notifications"][number];

export async function getNotifications(): Promise<NotificationInbox> {
  const clientId = getClientId();
  if (!clientId) {
    return { notifications: [], unreadCount: 0 };
  }

  const res = await fetch(`${api("/notifications")}?clientId=${encodeURIComponent(clientId)}`);
  if (!res.ok) throw new Error("Could not load notifications");
  return res.json();
}

export async function markNotificationsRead(notificationIds: string[] = []): Promise<NotificationInbox> {
  const clientId = getClientId();
  if (!clientId) {
    return { notifications: [], unreadCount: 0 };
  }

  const res = await fetch(api("/notifications"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, notificationIds }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Could not update notifications");
  return data;
}

export type DebugNotificationKind =
  | "leaderboard-top"
  | "leaderboard-toppled"
  | "pipeline-approved"
  | "pipeline-rejected"
  | "support-updated"
  | "support-closed";

export async function sendDebugNotification(kind: DebugNotificationKind): Promise<void> {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error("Could not find a client ID for test notifications");
  }

  const res = await fetch(api("/debug/notifications"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, kind }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Could not send test notification");
}
