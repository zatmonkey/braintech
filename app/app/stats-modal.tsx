"use client";

import { useEffect } from "react";
import { BrainrotMeter } from "./brainrot-meter";

/**
 * Stats popover. For v1 most categories show "—" until /api/account/usage
 * starts returning real telemetry-derived data. The shape is the contract.
 */
type AppMinutes = { app: string; minutes: number };

export function StatsModal({
  open,
  onClose,
  title,
  subtitle,
  brainrotMinutes,
  apps,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  brainrotMinutes: number | null;
  apps?: AppMinutes[];
}) {
  const list = apps ?? [];
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-rule)] bg-white p-5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="serif text-xl leading-snug">{title}</h3>
            {subtitle && (
              <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full text-[var(--color-ink-soft)] transition hover:bg-[var(--color-rule)]/40"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className="size-5"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="mt-5 flex items-center justify-center rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)] p-6">
          <BrainrotMeter minutes={brainrotMinutes} size="lg" />
        </div>

        <div className="mt-5">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
            Last 24h by app
          </div>
          {list.length === 0 ? (
            <p className="mt-3 rounded-lg bg-[var(--color-cream)] p-3 text-center text-sm text-[var(--color-ink-soft)]">
              No categorised app traffic in the last 24h.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-[var(--color-rule)] rounded-lg border border-[var(--color-rule)] bg-white">
              {list.slice(0, 10).map((a) => (
                <li
                  key={a.app}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="text-sm font-medium text-[var(--color-ink)]">
                    {a.app}
                  </span>
                  <span className="font-mono text-sm text-[var(--color-ink-soft)]">
                    {a.minutes}m
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
            The brain mark above turns green when the kid stays under 10 min
            a day of brainrot apps. Learning apps don&rsquo;t count.
          </p>
        </div>
      </div>
    </div>
  );
}
