const BASE =
  process.env.NEXT_PUBLIC_API_URL ??
  (typeof window !== "undefined" ? "http://localhost:3001" : "http://localhost:3001");

// All routes are under /api/ (Vercel serverless functions layout)
const api = (path: string) => `${BASE}/api${path}`;

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

export type Ticket = {
  number: number;
  title: string;
  url: string;
  state: string;
  labels: string[];
  createdAt: string;
  closedAt: string | null;
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
    body: JSON.stringify(params),
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

export async function getTickets(): Promise<{ issues: Ticket[]; resolved: Ticket[] }> {
  const res = await fetch(api("/tickets"));
  if (!res.ok) throw new Error("Could not load tickets");
  const data = await res.json();
  return { issues: (data.issues ?? []) as Ticket[], resolved: (data.resolved ?? []) as Ticket[] };
}

export type PlacePipelineStatus = {
  updatedAt: string | null;
  source: string;
  openRequests: Array<{
    number: number;
    title: string;
    url: string;
    requestedName: string;
    createdAt: string;
  }>;
  approvedCountries: Array<{
    number: number;
    title: string;
    url: string;
    requestedName: string;
    createdAt: string;
    canonicalName: string;
    source: string;
  }>;
  needsReview: Array<{
    number: number;
    title: string;
    url: string;
    requestedName: string;
    createdAt: string;
    reason: string;
  }>;
  totals: {
    open: number;
    approved: number;
    review: number;
  };
};

export async function getPlacePipeline(): Promise<PlacePipelineStatus> {
  const res = await fetch(api("/place-pipeline"));
  if (!res.ok) throw new Error("Could not load place pipeline");
  return res.json();
}

export async function submitTicket(params: {
  title: string;
  body: string;
  type: "bug" | "feature";
}): Promise<{ number: number; url: string }> {
  const res = await fetch(api("/tickets"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Could not submit ticket");
  return data;
}
