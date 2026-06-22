"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getNotifications, getPlacePipeline, getTickets, markNotificationsRead } from "@/lib/api";
import { getClientId } from "@/lib/client-id";
import { setupAndroidPushNotifications } from "@/lib/push";
import type { AppNotification } from "@/lib/notifications";

function notificationTone(kind: string): string {
  if (kind.includes("toppled")) return "from-rose-100 to-orange-100";
  if (kind.includes("top")) return "from-fuchsia-100 to-violet-100";
  if (kind.includes("pipeline")) return "from-amber-100 to-yellow-100";
  if (kind.includes("support")) return "from-cyan-100 to-sky-100";
  return "from-slate-100 to-slate-50";
}

export function NotificationCenter() {
  const [clientId, setClientId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setClientId(getClientId());
  }, []);

  async function syncSources() {
    await Promise.all([getTickets().catch(() => null), getPlacePipeline().catch(() => null)]);
  }

  async function loadNotifications() {
    if (!clientId) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    const inbox = await getNotifications();
    setNotifications(inbox.notifications);
    setUnreadCount(inbox.unreadCount);
  }

  useEffect(() => {
    let cancelled = false;
    let interval: number | null = null;

    async function refresh() {
      setLoading(true);
      try {
        await syncSources();
        await loadNotifications();
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void refresh();
    interval = window.setInterval(() => {
      void refresh();
    }, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
    };
  }, [clientId]);

  useEffect(() => {
    if (!clientId) {
      return;
    }

    let cleanup: (() => Promise<void> | void) | null = null;
    void setupAndroidPushNotifications((url) => {
      window.location.assign(url);
    }).then((teardown) => {
      cleanup = teardown;
    });

    return () => {
      void cleanup?.();
    };
  }, [clientId]);

  useEffect(() => {
    if (!open || !clientId) {
      return;
    }

    setUnreadCount(0);
    void markNotificationsRead().then((inbox) => {
      setNotifications(inbox.notifications);
      setUnreadCount(inbox.unreadCount);
    }).catch(() => {});
  }, [open, clientId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!clientId) {
    return null;
  }

  return (
    <div className="fixed right-4 top-[calc(1rem+env(safe-area-inset-top))] z-50">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-lg shadow-lg shadow-violet-200/60 backdrop-blur transition hover:bg-white"
        aria-label="Notifications"
      >
        🔔
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-fuchsia-600 px-1.5 py-0.5 text-[10px] font-black leading-none text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-3 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-[1.5rem] border border-white/70 bg-white/95 shadow-2xl shadow-violet-200/50 backdrop-blur">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <p className="text-sm font-black text-slate-900">Notifications</p>
              <p className="text-xs text-slate-500">
                {loading ? "Refreshing…" : unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
              </p>
            </div>
            <button
              type="button"
              className="text-sm font-semibold text-slate-500 hover:text-slate-700"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>

          <div className="max-h-[60vh] overflow-auto p-2">
            {notifications.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-slate-400">No notifications yet.</p>
            ) : (
              <div className="space-y-2">
                {notifications.map((item) => (
                  <Link
                    key={item.id}
                    href={item.targetUrl}
                    onClick={() => setOpen(false)}
                    className={`block rounded-2xl bg-gradient-to-br ${notificationTone(item.kind)} px-4 py-3 transition hover:brightness-95`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 text-lg">
                        {item.kind.includes("toppled")
                          ? "🏆"
                          : item.kind.includes("pipeline")
                            ? "🧩"
                            : item.kind.includes("support")
                              ? "💬"
                              : "🔔"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-900">{item.title}</p>
                        <p className="mt-0.5 text-sm text-slate-700">{item.body}</p>
                        <p className="mt-1 text-xs text-slate-500">Open</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
