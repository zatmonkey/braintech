"use client";

import { useState } from "react";

export type CalendarRow = {
  scheduled_for: string;
  theme: string | null;
  asset_url: string | null;
  prompt: string | null;
  caption: string | null;
  media_type: string;
  aspect_ratio: string | null;
  posted_at: string | null;
  permalink: string | null;
  ig_media_id: string | null;
  error_message: string | null;
};

const THEME_OPTIONS = [
  "problem_awareness",
  "rule_of_the_week",
  "educational",
  "engagement",
  "brand_founder",
  "testimonial_rule",
  "first_quiet_evening",
  "other",
];

const MEDIA_TYPE_OPTIONS = ["IMAGE", "STORIES", "REELS"] as const;

type Status = "idle" | "saving" | "saved" | "error";

export function CalendarClient({ initialRows }: { initialRows: CalendarRow[] }) {
  const [rows, setRows] = useState<CalendarRow[]>(initialRows);
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-ink-soft)]">
          {rows.length} {rows.length === 1 ? "row" : "rows"} ·
          {" "}
          {rows.filter((r) => r.posted_at).length} posted ·
          {" "}
          {rows.filter((r) => !r.asset_url && !r.posted_at).length} need an asset
        </p>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-lg border border-[var(--color-ink)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-ink)] hover:text-[var(--color-cream)]"
        >
          {adding ? "× Cancel" : "+ Add row"}
        </button>
      </div>

      {adding && (
        <NewRowForm
          onCreated={(row) => {
            setRows((rs) =>
              [...rs.filter((r) => r.scheduled_for !== row.scheduled_for), row].sort(
                (a, b) => a.scheduled_for.localeCompare(b.scheduled_for),
              ),
            );
            setAdding(false);
          }}
        />
      )}

      <div className="space-y-3">
        {rows.map((r) => (
          <RowCard
            key={r.scheduled_for}
            row={r}
            onUpdate={(next) => {
              setRows((rs) =>
                rs.map((x) => (x.scheduled_for === next.scheduled_for ? next : x)),
              );
            }}
            onDelete={() => {
              setRows((rs) => rs.filter((x) => x.scheduled_for !== r.scheduled_for));
            }}
          />
        ))}
      </div>
    </div>
  );
}

function NewRowForm({ onCreated }: { onCreated: (row: CalendarRow) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [theme, setTheme] = useState("problem_awareness");
  const [status, setStatus] = useState<Status>("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    const body = {
      scheduled_for: date,
      theme,
      media_type: "IMAGE",
    };
    const res = await fetch("/api/account/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setStatus("error");
      return;
    }
    setStatus("saved");
    onCreated({
      scheduled_for: date,
      theme,
      asset_url: null,
      prompt: null,
      caption: null,
      media_type: "IMAGE",
      aspect_ratio: null,
      posted_at: null,
      permalink: null,
      ig_media_id: null,
      error_message: null,
    });
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-[var(--color-rule)] bg-white p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--color-ink-soft)]">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border border-[var(--color-rule)] px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--color-ink-soft)]">Theme</span>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            className="rounded border border-[var(--color-rule)] px-2 py-1"
          >
            {THEME_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={status === "saving"}
          className="rounded-lg bg-[var(--color-ink)] px-3 py-1.5 text-sm font-medium text-[var(--color-cream)] hover:bg-[var(--color-accent)] disabled:opacity-60"
        >
          {status === "saving" ? "Saving…" : "Add"}
        </button>
        {status === "error" && (
          <span className="text-sm text-[var(--color-accent)]">Save failed.</span>
        )}
      </div>
    </form>
  );
}

function RowCard({
  row,
  onUpdate,
  onDelete,
}: {
  row: CalendarRow;
  onUpdate: (next: CalendarRow) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CalendarRow>(row);
  const [status, setStatus] = useState<Status>("idle");

  const posted = !!row.posted_at;
  const needsAsset = !row.asset_url && !row.posted_at;
  const dateObj = new Date(row.scheduled_for + "T12:00:00");
  const weekday = dateObj.toLocaleDateString("en-US", { weekday: "short" });
  const niceDate = dateObj.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  async function save() {
    setStatus("saving");
    const res = await fetch("/api/account/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduled_for: draft.scheduled_for,
        theme: draft.theme,
        asset_url: draft.asset_url || null,
        prompt: draft.prompt || null,
        caption: draft.caption || null,
        media_type: draft.media_type,
        aspect_ratio: draft.aspect_ratio || null,
      }),
    });
    if (!res.ok) {
      setStatus("error");
      return;
    }
    setStatus("saved");
    onUpdate(draft);
    setTimeout(() => setStatus("idle"), 1500);
  }

  async function del() {
    if (!confirm(`Delete row for ${row.scheduled_for}?`)) return;
    const res = await fetch("/api/account/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduled_for: row.scheduled_for, delete: true }),
    });
    if (res.ok) onDelete();
  }

  return (
    <div
      className={`rounded-2xl border bg-white p-4 ${
        posted
          ? "border-[var(--color-rule)] opacity-70"
          : needsAsset
            ? "border-amber-400/60"
            : "border-[var(--color-rule)]"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex w-14 shrink-0 flex-col items-center rounded-lg bg-[var(--color-cream)] py-1.5">
            <div className="text-[10px] uppercase text-[var(--color-ink-soft)]">
              {weekday}
            </div>
            <div className="text-sm font-semibold">{niceDate}</div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[var(--color-ink)]/5 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
                {row.theme ?? "—"}
              </span>
              <span className="rounded-full bg-[var(--color-ink)]/5 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
                {row.media_type}
              </span>
              {posted ? (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-emerald-700">
                  posted
                </span>
              ) : needsAsset ? (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-amber-700">
                  needs asset
                </span>
              ) : (
                <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-sky-700">
                  ready
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-sm text-[var(--color-ink-soft)]">
              {row.caption?.split("\n")[0] ?? "(no caption)"}
            </p>
          </div>
        </div>
        <span className="text-[var(--color-ink-soft)]">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-3 border-t border-[var(--color-rule)] pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Theme">
              <select
                value={draft.theme ?? ""}
                onChange={(e) => setDraft({ ...draft, theme: e.target.value })}
                className="w-full rounded border border-[var(--color-rule)] px-2 py-1.5 text-sm"
              >
                {THEME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Media type">
              <select
                value={draft.media_type}
                onChange={(e) =>
                  setDraft({ ...draft, media_type: e.target.value })
                }
                className="w-full rounded border border-[var(--color-rule)] px-2 py-1.5 text-sm"
              >
                {MEDIA_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Asset URL (publicly fetchable JPEG / image)">
            <input
              type="url"
              value={draft.asset_url ?? ""}
              placeholder="https://getbraintech.com/ig/..."
              onChange={(e) => setDraft({ ...draft, asset_url: e.target.value })}
              className="w-full rounded border border-[var(--color-rule)] px-2 py-1.5 text-sm"
            />
          </Field>

          <Field label="Generation prompt (Higgsfield, used if asset URL is empty)">
            <textarea
              value={draft.prompt ?? ""}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              rows={3}
              className="w-full rounded border border-[var(--color-rule)] px-2 py-1.5 text-sm leading-snug"
            />
          </Field>

          <Field label="Caption (FEED only — IG drops captions on stories)">
            <textarea
              value={draft.caption ?? ""}
              onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
              rows={8}
              className="w-full rounded border border-[var(--color-rule)] px-2 py-1.5 text-sm leading-snug"
            />
          </Field>

          {posted && (
            <div className="rounded-lg bg-[var(--color-cream)] p-3 text-xs">
              <div>
                <strong>Posted:</strong> {row.posted_at}
              </div>
              {row.permalink && (
                <div className="mt-1">
                  <a
                    href={row.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-accent)] underline"
                  >
                    {row.permalink}
                  </a>
                </div>
              )}
            </div>
          )}

          {row.error_message && !posted && (
            <div className="rounded-lg border border-amber-400/50 bg-amber-50 p-3 text-xs text-amber-900">
              <strong>Last attempt error:</strong> {row.error_message}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={status === "saving"}
              className="rounded-lg bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-[var(--color-cream)] hover:bg-[var(--color-accent)] disabled:opacity-60"
            >
              {status === "saving" ? "Saving…" : "Save"}
            </button>
            {status === "saved" && (
              <span className="text-sm text-emerald-700">Saved.</span>
            )}
            {status === "error" && (
              <span className="text-sm text-[var(--color-accent)]">
                Save failed.
              </span>
            )}
            <span className="flex-1" />
            <button
              type="button"
              onClick={del}
              className="text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-accent)]"
            >
              Delete row
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
        {label}
      </span>
      {children}
    </label>
  );
}
