"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getPlacePipeline, type PlacePipelineStatus } from "@/lib/api";
import { APP_VERSION } from "@/lib/version";

const emptyStatus: PlacePipelineStatus = {
  updatedAt: null,
  source: "redis",
  endpoint: "/api/place-pipeline",
  dictionaryVersion: null,
  openRequests: [],
  approvedCountries: [],
  rejectedRequests: [],
  needsReview: [],
  totals: { open: 0, approved: 0, rejected: 0, review: 0 },
};

export default function PipelinePage() {
  const [status, setStatus] = useState<PlacePipelineStatus>(emptyStatus);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPlacePipeline()
      .then((data) => setStatus({ ...emptyStatus, ...data }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-br from-violet-100 via-pink-50 to-cyan-100 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/support"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-slate-600 shadow-sm transition hover:bg-white"
          >
            ←
          </Link>
          <div>
            <h1 className="text-2xl font-black text-slate-900">Dictionary pipeline</h1>
            <p className="text-xs text-slate-500">Request intake, country auto-approval, and review queue</p>
          </div>
        </div>

        <section className="rounded-[2rem] bg-white/85 p-5 shadow-xl shadow-violet-200/60 backdrop-blur sm:p-6">
          <div className="flex flex-wrap gap-3 text-sm font-semibold text-slate-700">
            <span className="rounded-full bg-emerald-100 px-3 py-1">Open: {status.totals.open}</span>
            <span className="rounded-full bg-sky-100 px-3 py-1">Approved: {status.totals.approved}</span>
            <span className="rounded-full bg-rose-100 px-3 py-1">Rejected: {status.totals.rejected}</span>
            <span className="rounded-full bg-amber-100 px-3 py-1">Review: {status.totals.review}</span>
          </div>
          <p className="mt-3 text-sm text-slate-500">
            Endpoint: <code className="rounded bg-slate-100 px-1.5 py-0.5">/api/place-pipeline</code>
            {" · "}
            Dictionary version: {status.dictionaryVersion ?? "unknown"}
            {" · "}
            Updated {status.updatedAt ? new Date(status.updatedAt).toLocaleString() : "never"}.
            {loading ? " Loading..." : ""}
          </p>
        </section>

        <section className="rounded-[2rem] bg-white/85 p-5 shadow-xl shadow-violet-200/60 backdrop-blur sm:p-6">
          <h2 className="text-lg font-black text-slate-900">Auto-approved countries</h2>
          <div className="mt-4 space-y-3">
            {status.approvedCountries.length === 0 ? (
              <p className="text-sm text-slate-500">No approved country requests yet.</p>
            ) : (
              status.approvedCountries.map((item) => (
                <div key={item.id} className="rounded-2xl bg-emerald-50 px-4 py-3">
                  <p className="font-semibold text-slate-800">
                    {item.requestedName} → {item.canonicalName ?? item.requestedName}
                  </p>
                  <p className="text-xs text-emerald-700">Source: {item.source}</p>
                </div>
              ))
            )}
          </div>
        </section>

        {!loading && status.rejectedRequests.length > 0 && (
          <section className="rounded-[2rem] bg-white/80 p-5 shadow-xl shadow-rose-200/50 backdrop-blur sm:p-6">
            <h2 className="text-lg font-black text-slate-900">Rejected requests</h2>
            <div className="mt-4 space-y-2">
              {status.rejectedRequests.map((item) => (
                <div key={item.id} className="rounded-[1.25rem] bg-rose-50 px-4 py-3">
                  <p className="text-sm font-medium text-slate-700">{item.requestedName}</p>
                  <p className="text-xs text-rose-700">{item.reason}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-[2rem] bg-white/85 p-5 shadow-xl shadow-violet-200/60 backdrop-blur sm:p-6">
          <h2 className="text-lg font-black text-slate-900">Needs review</h2>
          <div className="mt-4 space-y-3">
            {status.needsReview.length === 0 ? (
              <p className="text-sm text-slate-500">No review items right now.</p>
            ) : (
              status.needsReview.map((item) => (
                <div key={item.id} className="rounded-2xl bg-amber-50 px-4 py-3">
                  <p className="font-semibold text-slate-800">{item.requestedName}</p>
                  <p className="text-sm text-amber-800">{item.reason}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <div className="flex items-center text-sm text-slate-400">
          <div className="flex flex-1 justify-center gap-6">
            <Link href="/" className="hover:text-slate-600">
              Play
            </Link>
            <Link href="/leaderboard" className="hover:text-slate-600">
              Leaderboard
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
