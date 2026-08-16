"use client";

"use client";

import { Capacitor } from "@capacitor/core";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { APP_VERSION } from "@/lib/version";
import { Suspense, useEffect, useRef, useState } from "react";
import { getLeaderboard, getStats, type LeaderboardEntry } from "@/lib/api";

// ── Share card shown when ?entry=<id> is in the URL ──────────────────────────

function ShareCard({ entry, rank }: { entry: LeaderboardEntry; rank: number }) {
  const [copied, setCopied] = useState(false);
  // In Capacitor, window.location.origin is "http://localhost" — useless as a share link.
  // Only show sharing on web where the URL is a real public address.
  const isNative = typeof window !== "undefined" && Capacitor.getPlatform() !== "web";
  const shareUrl =
    typeof window !== "undefined" && !isNative
      ? `${window.location.origin}/leaderboard?entry=${entry.id}`
      : "";

  async function share() {
    if (navigator.share) {
      await navigator.share({
        title: "Atlas Leaderboard",
        text: `🎮 I'm ranked #${rank} on Atlas with ${entry.score} turns — ${entry.name}!`,
        url: shareUrl,
      });
    } else {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="mb-6 rounded-[2rem] border-2 border-fuchsia-300 bg-gradient-to-br from-fuchsia-600 to-violet-700 p-6 text-center text-white shadow-xl shadow-fuchsia-300/40">
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-fuchsia-200">
        🎮 Atlas All-Time
      </p>
      <p className="mt-2 font-mono text-5xl font-black tracking-tight">#{rank}</p>
      <p className="mt-1 text-2xl font-bold">{entry.name}</p>
      <p className="mt-1 text-fuchsia-200">
        {entry.score} turn{entry.score !== 1 ? "s" : ""} &middot;{" "}
        {entry.date ? new Date(entry.date).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""}
      </p>
      {!isNative && (
        <button
          onClick={share}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/20 px-5 py-2 text-sm font-bold text-white backdrop-blur transition hover:bg-white/30"
        >
          {copied ? "✓ Link copied!" : "Share this"}
        </button>
      )}
    </div>
  );
}

// ── Rank medal colours ────────────────────────────────────────────────────────

function rankStyle(rank: number) {
  if (rank === 1) return "text-yellow-500 font-black";
  if (rank === 2) return "text-slate-400 font-black";
  if (rank === 3) return "text-amber-600 font-black";
  return "text-slate-400 font-semibold";
}

function rankLabel(rank: number) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

// ── Main leaderboard view (inside Suspense for useSearchParams) ───────────────

function LeaderboardContent() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("entry");

  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [gamesPlayed, setGamesPlayed] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    Promise.all([getLeaderboard(), getStats()])
      .then(([scores, stats]) => {
        setEntries(scores);
        setGamesPlayed(stats.games);
      })
      .catch(() => setError("Couldn't load scores. Try again later."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [entries]);

  const highlightEntry = entries.find((e) => e.id === highlightId);

  return (
    <div className="space-y-4">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-slate-600 shadow-sm transition hover:bg-white"
          data-testid="leaderboard-home-link"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-mono text-2xl font-black tracking-tight text-slate-900" data-testid="leaderboard-page-title">
                🏆 HIGH SCORES
              </h1>
              <p className="text-xs text-slate-500" data-testid="leaderboard-page-subtitle">
                Total turns across all players per game
              </p>
            </div>
            {gamesPlayed !== null && (
              <div className="shrink-0 rounded-2xl bg-white/85 px-3 py-2 text-right shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-400">
                  Total games
                </p>
                <p className="text-xl font-black text-slate-900">{gamesPlayed}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {highlightEntry && <ShareCard entry={highlightEntry} rank={highlightEntry.rank} />}

      {loading && (
        <div className="py-16 text-center text-slate-400">Loading scores…</div>
      )}

      {error && (
        <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4 text-center text-sm text-rose-700">
          {error}
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div className="py-16 text-center text-slate-400">
          No scores yet. Play a game and end it to be the first!
        </div>
      )}

      {entries.map((entry) => {
        const isHighlighted = entry.id === highlightId;
        return (
          <div
            key={entry.id}
            ref={isHighlighted ? highlightRef : undefined}
            className={`flex items-center gap-4 rounded-[1.5rem] px-5 py-4 transition ${
              isHighlighted
                ? "bg-fuchsia-50 ring-2 ring-fuchsia-300 shadow-lg shadow-fuchsia-200/50"
                : "bg-white/80 shadow-sm"
            }`}
          >
            <span className={`w-10 shrink-0 text-right font-mono text-lg ${rankStyle(entry.rank)}`}>
              {rankLabel(entry.rank)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold text-slate-900">{entry.name}</p>
              <p className="text-xs text-slate-400">
                {entry.date
                  ? new Date(entry.date).toLocaleDateString("en-US", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  : ""}
              </p>
            </div>
            <span className="shrink-0 font-mono text-lg font-black text-fuchsia-600">
              {entry.score}
            </span>
            <span className="shrink-0 text-xs text-slate-400">turns</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LeaderboardPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-violet-100 via-pink-50 to-cyan-100 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-lg">
        <Suspense fallback={<div className="py-16 text-center text-slate-400">Loading…</div>}>
          <LeaderboardContent />
        </Suspense>

        {/* Footer links */}
        <div className="mt-8 flex items-center text-sm text-slate-400">
          <div className="flex flex-1 justify-center gap-6">
            <Link href="/" className="hover:text-slate-600">
              Play
            </Link>
            <Link href="/support" className="hover:text-slate-600">
              Support
            </Link>
          </div>
          <span className="text-slate-300">v{APP_VERSION}</span>
        </div>
      </div>
    </main>
  );
}
