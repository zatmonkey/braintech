"use client";

/**
 * Three social-proof widgets that share one data source:
 *   - <FoundingBadge>    tiny "47 / 1,000 reserved" pill for the hero eyebrow
 *   - <FoundingMeter>    larger progress card for the pricing section
 *   - <FoundingToasts>   rolling "Sarah from Austin just reserved" toast
 *
 * All three fetch /api/founding-stats once on mount; the API is CDN-cached
 * for 30s so the network cost is negligible even at high traffic.
 */

import { useEffect, useState } from "react";

type ActivityEvent = {
  name: string;
  region: string;
  minutesAgo: number;
  real: boolean;
};

type Stats = {
  reserved: number;
  total: number;
  recent: ActivityEvent[];
};

let cached: Stats | null = null;
let inflight: Promise<Stats | null> | null = null;

async function loadStats(): Promise<Stats | null> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/founding-stats", { cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as Stats;
      cached = data;
      return data;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function useStats(): Stats | null {
  const [stats, setStats] = useState<Stats | null>(cached);
  useEffect(() => {
    if (cached) return;
    let live = true;
    loadStats().then((s) => {
      if (live && s) setStats(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return stats;
}

export function FoundingBadge() {
  const stats = useStats();
  // Reserve space pre-load so the hero doesn't jump.
  const reserved = stats?.reserved ?? null;
  const total = stats?.total ?? 1000;
  return (
    <span className="tabular-nums">
      {reserved === null ? (
        <span className="opacity-60">Founding batch — 1,000 devices</span>
      ) : (
        <>
          <strong className="font-semibold text-[var(--color-ink)]">
            {reserved}
          </strong>
          <span className="opacity-70"> / {total} founding devices reserved</span>
        </>
      )}
    </span>
  );
}

export function FoundingMeter() {
  const stats = useStats();
  const reserved = stats?.reserved ?? 47;
  const total = stats?.total ?? 1000;
  const pct = Math.max(2, Math.min(100, (reserved / total) * 100));
  const remaining = Math.max(0, total - reserved);

  return (
    <div className="mt-6 rounded-2xl border border-[var(--color-rule)] bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-medium text-[var(--color-ink)]">
          <span className="tabular-nums">{reserved}</span>
          <span className="text-[var(--color-ink-soft)]"> / {total} reserved</span>
        </div>
        <div className="text-xs text-[var(--color-ink-soft)]">
          {remaining} spots left at this price
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-rule)]/60">
        <div
          className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Toasts                                                                    */
/* ------------------------------------------------------------------------- */

// Per-session cap so we don't pester returning visitors.
const SESSION_CAP = 4;
const SESSION_KEY = "bt_toast_count";

function formatAgo(minutes: number): string {
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function FoundingToasts() {
  const stats = useStats();
  const [current, setCurrent] = useState<ActivityEvent | null>(null);
  const [shown, setShown] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Honor an explicit close: don't re-show this session.
    if (dismissed) return;
    if (!stats || stats.recent.length === 0) return;

    // Hydrate the session counter so reloads/back-button don't reset us.
    if (typeof window !== "undefined") {
      const prior = Number(sessionStorage.getItem(SESSION_KEY) ?? "0");
      if (prior >= SESSION_CAP) {
        setDismissed(true);
        return;
      }
      if (shown === 0 && prior > 0) setShown(prior);
    }

    if (shown >= SESSION_CAP) return;

    // Stagger: first toast 8–15s in, then 25–45s between.
    const delay =
      shown === 0
        ? 8_000 + Math.floor(((Date.now() >> 4) & 0xff) * 27)
        : 25_000 + Math.floor(((Date.now() >> 3) & 0xff) * 78);

    const t = setTimeout(() => {
      const event = stats.recent[shown % stats.recent.length];
      setCurrent(event);
      setShown((n) => {
        const next = n + 1;
        if (typeof window !== "undefined") {
          sessionStorage.setItem(SESSION_KEY, String(next));
        }
        return next;
      });

      // Auto-dismiss the toast after ~7s; the next one will rearm via the
      // dependency on `shown` below.
      const hideAfter = setTimeout(() => setCurrent(null), 7_000);
      return () => clearTimeout(hideAfter);
    }, delay);

    return () => clearTimeout(t);
  }, [stats, shown, dismissed]);

  if (!current || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      // Bottom-LEFT so we don't fight with the ChatWidget on bottom-right.
      // Hidden on the smallest screens so the form input is never obscured.
      className="pointer-events-none fixed bottom-5 left-5 z-40 hidden max-w-[300px] sm:block"
    >
      <div className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-[var(--color-rule)] bg-white px-4 py-3 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)] fade-up">
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
          <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4L8.5 12l6.8-6.7a1 1 0 0 1 1.4 0Z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="min-w-0 flex-1 text-[13px] leading-snug">
          <div className="font-medium text-[var(--color-ink)]">
            {current.name} from {current.region}
          </div>
          <div className="text-[var(--color-ink-soft)]">
            Reserved a founding device · {formatAgo(current.minutesAgo)}
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 grid size-6 shrink-0 place-items-center rounded-full text-[var(--color-ink-soft)] transition hover:bg-[var(--color-rule)]/40"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            className="size-3.5"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
