"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getTickets, submitTicket, type Ticket } from "@/lib/api";
import { APP_VERSION } from "@/lib/version";

type SubmitState = "idle" | "submitting" | "done" | "error";

const labelColour: Record<string, string> = {
  bug: "bg-rose-100 text-rose-700",
  enhancement: "bg-sky-100 text-sky-700",
  "atlas-app": "bg-violet-100 text-violet-700",
};

function TicketLabel({ name }: { name: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
        labelColour[name] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {name}
    </span>
  );
}

export default function SupportPage() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<"bug" | "feature">("bug");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submittedUrl, setSubmittedUrl] = useState<string | null>(null);
  const [submittedNumber, setSubmittedNumber] = useState<number | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [resolved, setResolved] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);

  useEffect(() => {
    getTickets()
      .then(({ issues, resolved: done }) => {
        setTickets(issues);
        setResolved(done);
      })
      .catch(() => {})
      .finally(() => setTicketsLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitState("submitting");
    try {
      const result = await submitTicket({ title: title.trim(), body: body.trim(), type });
      setSubmittedUrl(result.url);
      setSubmittedNumber(result.number);
      setSubmitState("done");
      // Reload tickets list to include the new one
      getTickets().then(({ issues, resolved: done }) => { setTickets(issues); setResolved(done); }).catch(() => {});
    } catch {
      setSubmitState("error");
    }
  }

  const primaryButton =
    "inline-flex items-center justify-center rounded-full bg-fuchsia-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-fuchsia-300/50 transition hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:bg-fuchsia-300";
  const secondaryButton =
    "inline-flex items-center justify-center rounded-full border border-white/60 bg-white/80 px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur transition hover:bg-white";

  return (
    <main className="min-h-screen bg-gradient-to-br from-violet-100 via-pink-50 to-cyan-100 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-lg space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-slate-600 shadow-sm transition hover:bg-white"
          >
            ←
          </Link>
          <div>
            <h1 className="text-2xl font-black text-slate-900">Support</h1>
            <p className="text-xs text-slate-500">Report a bug or suggest a feature</p>
          </div>
        </div>

        {/* Submission form */}
        <article className="rounded-[2rem] bg-white/85 p-5 shadow-xl shadow-violet-200/60 backdrop-blur sm:p-6">
          {submitState === "done" ? (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <span className="text-4xl">✅</span>
              <p className="font-bold text-slate-900">
                Ticket #{submittedNumber} submitted!
              </p>
              <p className="text-sm text-slate-500">
                You can track it on GitHub — your ask is now on our radar.
              </p>
              {submittedUrl && (
                <a
                  href={submittedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-fuchsia-600 underline underline-offset-2"
                >
                  View ticket on GitHub →
                </a>
              )}
              <button
                className={secondaryButton}
                onClick={() => {
                  setTitle("");
                  setBody("");
                  setSubmitState("idle");
                  setSubmittedUrl(null);
                }}
              >
                Submit another
              </button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <h2 className="text-lg font-black text-slate-900">Send us feedback</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Your ticket opens a GitHub issue — you can track it publicly.
                </p>
              </div>

              {/* Type toggle */}
              <div className="flex gap-2">
                {(["bug", "feature"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`flex-1 rounded-full border py-2 text-sm font-semibold transition ${
                      type === t
                        ? "border-fuchsia-300 bg-fuchsia-600 text-white shadow-md"
                        : "border-white/60 bg-white/80 text-slate-600 hover:bg-white"
                    }`}
                  >
                    {t === "bug" ? "🐛 Bug" : "💡 Feature request"}
                  </button>
                ))}
              </div>

              <input
                className="w-full rounded-[1.5rem] border border-white bg-white px-5 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-fuchsia-300 focus:ring-4 focus:ring-fuchsia-100"
                maxLength={256}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Short title *"
                required
                type="text"
                value={title}
              />

              <textarea
                className="w-full rounded-[1.5rem] border border-white bg-white px-5 py-3 text-sm text-slate-700 outline-none transition focus:border-fuchsia-300 focus:ring-4 focus:ring-fuchsia-100"
                maxLength={4096}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe the bug or feature in detail (optional)"
                rows={4}
                value={body}
              />

              {submitState === "error" && (
                <p className="text-sm text-rose-600">
                  Something went wrong. Please try again.
                </p>
              )}

              <button
                className={`${primaryButton} w-full`}
                disabled={submitState === "submitting" || !title.trim()}
                type="submit"
              >
                {submitState === "submitting" ? "Submitting…" : "Submit ticket"}
              </button>
            </form>
          )}
        </article>

        {/* Open tickets list */}
        <article className="rounded-[2rem] bg-white/80 p-5 shadow-xl shadow-amber-200/50 backdrop-blur sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-black text-slate-900">Open tickets</h2>
            {!ticketsLoading && (
              <span className="rounded-full bg-gradient-to-r from-cyan-200 to-violet-200 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-slate-700">
                {tickets.length}
              </span>
            )}
          </div>

          <div className="mt-4">
            {ticketsLoading && (
              <p className="text-sm text-slate-400">Loading tickets…</p>
            )}
            {!ticketsLoading && tickets.length === 0 && (
              <p className="text-sm text-slate-400">No open tickets — all clear! 🎉</p>
            )}
            {tickets.map((ticket) => (
              <a
                key={ticket.number}
                className="flex items-start gap-3 rounded-[1.25rem] p-3 transition hover:bg-slate-50"
                href={ticket.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                <span className="mt-0.5 text-slate-400">#{ticket.number}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{ticket.title}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {ticket.labels
                      .filter((l) => l !== "atlas-app")
                      .map((l) => (
                        <TicketLabel key={l} name={l} />
                      ))}
                  </div>
                </div>
                <span className="shrink-0 text-slate-300">→</span>
              </a>
            ))}
          </div>
        </article>

        {/* Resolved tickets list */}
        {!ticketsLoading && resolved.length > 0 && (
          <article className="rounded-[2rem] bg-white/70 p-5 shadow-xl shadow-emerald-200/40 backdrop-blur sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-black text-slate-900">✅ Resolved</h2>
              <span className="rounded-full bg-gradient-to-r from-emerald-200 to-teal-200 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-slate-700">
                {resolved.length}
              </span>
            </div>
            <div className="mt-4 space-y-0.5">
              {resolved.map((ticket) => (
                <a
                  key={ticket.number}
                  className="flex items-start gap-3 rounded-[1.25rem] p-3 transition hover:bg-emerald-50/60"
                  href={ticket.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <span className="mt-0.5 text-slate-300">#{ticket.number}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-500 line-through decoration-slate-300">
                      {ticket.title}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {ticket.labels
                        .filter((l) => l !== "atlas-app")
                        .map((l) => (
                          <TicketLabel key={l} name={l} />
                        ))}
                    </div>
                  </div>
                  <span className="shrink-0 text-emerald-400">✓</span>
                </a>
              ))}
            </div>
          </article>
        )}

        {/* Footer */}
        <div className="flex items-center text-sm text-slate-400">
          <div className="flex flex-1 justify-center gap-6">
            <Link href="/" className="hover:text-slate-600">
              Play
            </Link>
            <Link href="/leaderboard" className="hover:text-slate-600">
              Leaderboard
            </Link>
          </div>
          <span className="text-slate-300">v{APP_VERSION}</span>
        </div>
      </div>
    </main>
  );
}
