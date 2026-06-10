"use client";

import { useEffect } from "react";
import { BrainrotMeter } from "./brainrot-meter";

/**
 * Stats popover. For v1 most categories show "—" until /api/account/usage
 * starts returning real telemetry-derived data. The shape is the contract.
 */
export function StatsModal({
  open,
  onClose,
  title,
  subtitle,
  brainrotMinutes,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  brainrotMinutes: number | null;
}) {
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
            Last 24h by category
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {[
              { k: "Social", colored: true },
              { k: "Video", colored: true },
              { k: "Games", colored: true },
              { k: "Learning", colored: false },
            ].map((c) => (
              <div
                key={c.k}
                className="rounded-lg bg-[var(--color-cream)] p-3 text-center"
              >
                <div
                  className={`text-[10px] font-medium uppercase tracking-wider ${
                    c.colored ? "text-[var(--color-accent)]" : "text-emerald-700"
                  }`}
                >
                  {c.k}
                </div>
                <div className="mt-1 font-mono text-base">—</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
            Per-category usage starts populating once your Braintech device
            streams telemetry. The brain mark above turns green when the kid
            stays under 10 min of short-form video / social a day.
          </p>
        </div>
      </div>
    </div>
  );
}
