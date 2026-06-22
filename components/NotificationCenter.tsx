"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getNotifications, getPlacePipeline, getTickets, markNotificationsRead } from "@/lib/api";
import { getClientId } from "@/lib/client-id";
import { setupAndroidPushNotifications } from "@/lib/push";
import type { AppNotification } from "@/lib/notifications";

function notificationTone(kind: string): string {
  if (kind.includes("toppled")) return "border-rose-100";
  if (kind.includes("top")) return "border-fuchsia-100";
  if (kind.includes("pipeline")) return "border-amber-100";
  if (kind.includes("support")) return "border-cyan-100";
  return "border-slate-100";
}

function notificationGlyph(kind: string): string {
  if (kind.includes("toppled")) return "🏆";
  if (kind.includes("top")) return "⭐";
  if (kind.includes("pipeline")) return "🧩";
  if (kind.includes("support")) return "💬";
  return "🔔";
}

function isRead(item: AppNotification): boolean {
  return Boolean(item.readAt);
}

export function NotificationCenter() {
  const [clientId] = useState(() => getClientId());
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  async function syncSources() {
    await Promise.all([getTickets().catch(() => null), getPlacePipeline().catch(() => null)]);
  }

  const loadNotifications = useCallback(async () => {
    if (!clientId) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    const inbox = await getNotifications();
    setNotifications(inbox.notifications);
    setUnreadCount(inbox.unreadCount);
  }, [clientId]);

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
  }, [clientId, loadNotifications]);

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

    void markNotificationsRead().then((inbox) => {
      setNotifications(inbox.notifications);
      setUnreadCount(inbox.unreadCount);
    }).catch(() => {});
  }, [open, clientId]);

  useEffect(() => {
    function onRefresh() {
      void loadNotifications().catch(() => {});
    }

    window.addEventListener("atlas:notifications-refresh", onRefresh);
    return () => window.removeEventListener("atlas:notifications-refresh", onRefresh);
  }, [loadNotifications]);

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
    <div className="fixed right-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative flex h-10 w-10 items-center justify-center rounded-[1.1rem] border border-white/70 bg-white/80 text-violet-700 shadow-md shadow-slate-200/40 backdrop-blur transition hover:bg-white"
        aria-label="Notifications"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5">
          <path
            d="M12 5c-2.76 0-5 2.24-5 5v2.2c0 .74-.22 1.47-.64 2.1L5 15.9h14l-1.36-1.6a3.8 3.8 0 0 1-.64-2.1V10c0-2.76-2.24-5-5-5Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M10.1 18.5a2 2 0 0 0 3.8 0"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-fuchsia-600 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white shadow">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-3 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-[1.4rem] border border-white/70 bg-white/82 shadow-2xl shadow-slate-200/40 backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-slate-100/80 px-4 py-3">
            <div>
              <p className="text-[13px] font-semibold text-slate-900">Notifications</p>
              <p className="text-[11px] text-slate-500">
                {loading ? "Refreshing…" : unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
              </p>
            </div>
            <button
              type="button"
              className="text-[13px] font-medium text-slate-500 hover:text-slate-700"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>

          <div className="max-h-[58vh] overflow-auto p-2">
            {notifications.length === 0 ? (
              <p className="px-3 py-8 text-center text-[13px] text-slate-400">No notifications yet.</p>
            ) : (
              <div className="space-y-2">
                {notifications.map((item) => (
                  <Link
                    key={item.id}
                    href={item.targetUrl}
                    onClick={() => setOpen(false)}
                    className={`block rounded-2xl border px-3 py-2.5 transition ${notificationTone(item.kind)} ${
                      isRead(item) ? "bg-slate-50/90 opacity-55" : "bg-white"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 text-sm opacity-75">
                        {notificationGlyph(item.kind)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-slate-800">{item.title}</p>
                        <p className="mt-0.5 text-[12px] leading-5 text-slate-500">{item.body}</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {isRead(item) ? "Read" : "Open"}
                        </p>
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
