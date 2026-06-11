"use client";

/**
 * Per-group app activity audit + quick-decide modal. Opened from the
 * "Activity" chip on the group toolbar. Fetches
 * /api/account/group-activity lazily on open and lets the parent
 * stamp 'OK' or 'Limit' per app via /api/account/app-classify.
 *
 * The classification doesn't enforce anything by itself — it records
 * the parent's view + silences the email-alert cron. Actual blocking
 * still goes through block_brainrot_group / schedule rules.
 */
import { useCallback, useEffect, useState } from "react";

type AppRow = {
  app: string;
  minutes_today: number;
  minutes_7d: number;
  status: "ok" | "limit" | null;
  rollup: "brainrot" | "learning" | "other";
  decided_at: string | null;
};

type GroupRef = { group_id: string; name: string } | null;

function fmt(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

export function GroupActivityModal({
  open,
  group,
  onClose,
}: {
  open: boolean;
  group: GroupRef;
  onClose: () => void;
}) {
  const [apps, setApps] = useState<AppRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!group) return;
    setApps(null);
    setError(null);
    try {
      const res = await fetch(
        `/api/account/group-activity?group_id=${encodeURIComponent(group.group_id)}`,
      );
      const data = (await res.json()) as { ok?: boolean; apps?: AppRow[]; error?: string };
      if (data.ok && Array.isArray(data.apps)) setApps(data.apps);
      else setError(data.error ?? "Couldn't load activity.");
    } catch {
      setError("Network hiccup — try again.");
    }
  }, [group]);

  useEffect(() => {
    if (!open || !group) return;
    void load();
  }, [open, group, load]);

  async function decide(app: string, status: "ok" | "limit") {
    if (!group) return;
    setPending(app + ":" + status);
    try {
      const res = await fetch("/api/account/app-classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_id: group.group_id,
          app,
          status,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Couldn't save that.");
        setPending(null);
        return;
      }
      // Optimistic: bump the row's status in place.
      setApps((rows) =>
        rows
          ? rows.map((r) => (r.app === app ? { ...r, status, decided_at: new Date().toISOString() } : r))
          : rows,
      );
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setPending(null);
    }
  }

  if (!open || !group) return null;

  const undecided = apps?.filter((r) => r.status === null) ?? [];
  const decided = apps?.filter((r) => r.status !== null) ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-rule)] px-5 py-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
              Activity
            </div>
            <h2 className="serif mt-1 text-xl leading-snug">{group.name}</h2>
            <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
              Apps your kid spent time on · today + last 7 days
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-full text-[var(--color-ink-soft)] transition hover:bg-[var(--color-cream)]/80 hover:text-[var(--color-ink)]"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!apps && !error ? (
            <div className="py-8 text-center text-sm text-[var(--color-ink-soft)]">
              Loading…
            </div>
          ) : null}
          {error ? (
            <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          ) : null}
          {apps && apps.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--color-rule)] bg-[var(--color-cream)]/40 p-6 text-center text-sm text-[var(--color-ink-soft)]">
              No activity recorded yet for this group.
            </div>
          ) : null}

          {undecided.length > 0 ? (
            <>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-accent)]">
                Needs your call ({undecided.length})
              </div>
              <ul className="mb-5 space-y-2">
                {undecided.map((r) => (
                  <AppRowCard
                    key={r.app}
                    row={r}
                    pending={pending}
                    onDecide={decide}
                  />
                ))}
              </ul>
            </>
          ) : null}

          {decided.length > 0 ? (
            <>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
                Decided ({decided.length})
              </div>
              <ul className="space-y-2">
                {decided.map((r) => (
                  <AppRowCard
                    key={r.app}
                    row={r}
                    pending={pending}
                    onDecide={decide}
                  />
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AppRowCard({
  row,
  pending,
  onDecide,
}: {
  row: AppRow;
  pending: string | null;
  onDecide: (app: string, status: "ok" | "limit") => void;
}) {
  const isPending = pending !== null && pending.startsWith(row.app + ":");
  const rollupBadge =
    row.rollup === "brainrot"
      ? { label: "Brainrot", classes: "bg-red-50 text-red-700" }
      : row.rollup === "learning"
        ? { label: "Learning", classes: "bg-emerald-50 text-emerald-700" }
        : { label: "Other", classes: "bg-[var(--color-cream)] text-[var(--color-ink-soft)]" };

  return (
    <li className="rounded-2xl border border-[var(--color-rule)] bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[var(--color-ink)]">
              {row.app}
            </span>
            <span
              className={
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
                rollupBadge.classes
              }
            >
              {rollupBadge.label}
            </span>
            {row.status === "ok" ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                ✓ OK
              </span>
            ) : null}
            {row.status === "limit" ? (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-800">
                🚫 Limit
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-[var(--color-ink-soft)]">
            <strong className="text-[var(--color-ink)]">{fmt(row.minutes_today)}</strong> today ·{" "}
            <strong className="text-[var(--color-ink)]">{fmt(row.minutes_7d)}</strong> over 7d
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            disabled={isPending || row.status === "ok"}
            onClick={() => onDecide(row.app, "ok")}
            className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-40"
          >
            ✓ OK
          </button>
          <button
            type="button"
            disabled={isPending || row.status === "limit"}
            onClick={() => onDecide(row.app, "limit")}
            className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-40"
          >
            🚫 Limit
          </button>
        </div>
      </div>
    </li>
  );
}
