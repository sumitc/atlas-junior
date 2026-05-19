const BASE =
  process.env.NEXT_PUBLIC_API_URL ??
  (typeof window !== "undefined" ? "http://localhost:3001" : "http://localhost:3001");

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
  labels: string[];
  createdAt: string;
};

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const res = await fetch(`${BASE}/leaderboard`);
  if (!res.ok) throw new Error("Could not load leaderboard");
  const data = await res.json();
  return data.entries as LeaderboardEntry[];
}

export async function submitScore(params: {
  name: string;
  score: number;
  date: string;
  entryId: string;
}): Promise<SubmitResult> {
  const res = await fetch(`${BASE}/leaderboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Could not save score");
  return res.json();
}

export async function getTickets(): Promise<Ticket[]> {
  const res = await fetch(`${BASE}/tickets`);
  if (!res.ok) throw new Error("Could not load tickets");
  const data = await res.json();
  return data.issues as Ticket[];
}

export async function submitTicket(params: {
  title: string;
  body: string;
  type: "bug" | "feature";
}): Promise<{ number: number; url: string }> {
  const res = await fetch(`${BASE}/tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Could not submit ticket");
  return data;
}
