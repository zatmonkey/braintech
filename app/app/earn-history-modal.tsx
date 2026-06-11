"use client";

/**
 * Per-group earn audit modal. Opened by the "X earned" chip on the
 * group toolbar (dashboard-client). Fetches /api/account/earn/history
 * lazily on open and shows every claim — passed, failed, in-flight —
 * with the YouTube link for the video and the kid's answers per
 * question (MC: which choice they picked vs the correct one; open:
 * the full text).
 */
import { useEffect, useState } from "react";

type PerQuestion =
  | {
      kind: "mc";
      question: string;
      choices: string[];
      correct_choice: string;
      kid_choice: string;
      correct: boolean;
    }
  | {
      kind: "open";
      question: string;
      kid_answer: string;
    };

type Claim = {
  claim_id: string;
  mac: string;
  activity_type: string;
  subject: string;
  video_id: string | null;
  video: {
    title: string;
    speaker: string;
    source: string;
    youtube_id: string;
    youtube_url: string;
    duration_seconds: number;
  } | null;
  score: number | null;
  max_score: number | null;
  passed: boolean | null;
  credit_granted: number;
  created_at: string;
  scored_at: string | null;
  per_question: PerQuestion[];
};

type GroupRef = { group_id: string; name: string } | null;

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function EarnHistoryModal({
  open,
  group,
  onClose,
}: {
  open: boolean;
  group: GroupRef;
  onClose: () => void;
}) {
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !group) {
      setClaims(null);
      setError(null);
      setExpanded(null);
      return;
    }
    let alive = true;
    fetch(
      `/api/account/earn/history?group_id=${encodeURIComponent(group.group_id)}`,
    )
      .then((r) => r.json())
      .then((data: { ok: boolean; claims?: Claim[]; error?: string }) => {
        if (!alive) return;
        if (data.ok && Array.isArray(data.claims)) {
          setClaims(data.claims);
        } else {
          setError(data.error ?? "Couldn't load earn history.");
        }
      })
      .catch(() => {
        if (alive) setError("Network hiccup — try again.");
      });
    return () => {
      alive = false;
    };
  }, [open, group]);

  if (!open || !group) return null;

  const passed = claims?.filter((c) => c.passed) ?? [];
  const others = claims?.filter((c) => !c.passed) ?? [];

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
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-rule)] px-5 py-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
              Earn log
            </div>
            <h2 className="serif mt-1 text-xl leading-snug">
              {group.name}
            </h2>
            {claims ? (
              <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                {passed.length} passed · {others.length} attempted ·{" "}
                {passed.reduce((n, c) => n + (c.credit_granted ?? 0), 0)}m earned
              </p>
            ) : null}
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!claims && !error ? (
            <div className="py-8 text-center text-sm text-[var(--color-ink-soft)]">
              Loading…
            </div>
          ) : null}
          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {error}
            </div>
          ) : null}
          {claims && claims.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--color-rule)] bg-[var(--color-cream)]/40 p-6 text-center text-sm text-[var(--color-ink-soft)]">
              No quizzes attempted yet for this group.
            </div>
          ) : null}
          {claims && claims.length > 0 ? (
            <ul className="space-y-3">
              {claims.map((c) => {
                const isOpen = expanded === c.claim_id;
                const scoreLabel =
                  c.score != null && c.max_score != null
                    ? `${c.score}/${c.max_score}`
                    : c.scored_at
                      ? "—"
                      : "in flight";
                return (
                  <li
                    key={c.claim_id}
                    className="rounded-2xl border border-[var(--color-rule)] bg-white"
                  >
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : c.claim_id)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left"
                    >
                      <span
                        className={
                          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold " +
                          (c.passed
                            ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                            : c.scored_at
                              ? "bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)]"
                              : "bg-yellow-100 text-yellow-800")
                        }
                        aria-hidden
                      >
                        {c.passed ? "✓" : c.scored_at ? "·" : "…"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-[var(--color-ink)]">
                          {c.video?.title ?? c.subject}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-[var(--color-ink-soft)]">
                          {c.video
                            ? `${c.video.speaker} · ${c.video.source === "ted-ed" ? "TED-Ed" : "TED"}`
                            : c.activity_type}
                          {" · "}
                          {relativeTime(c.created_at)}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-xs">
                        <span className="font-mono text-[var(--color-ink-soft)]">
                          {scoreLabel}
                        </span>
                        {c.passed ? (
                          <span className="rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 font-semibold text-[var(--color-accent)]">
                            +{c.credit_granted}m
                          </span>
                        ) : null}
                        <span aria-hidden className="text-[var(--color-ink-soft)]">
                          {isOpen ? "▾" : "▸"}
                        </span>
                      </div>
                    </button>
                    {isOpen ? (
                      <div className="border-t border-[var(--color-rule)] bg-[var(--color-cream)]/30 px-4 py-3">
                        {c.video ? (
                          <p className="mb-3 text-xs text-[var(--color-ink-soft)]">
                            Verify what they watched:{" "}
                            <a
                              href={c.video.youtube_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-[var(--color-accent)] underline-offset-2 hover:underline"
                            >
                              open on YouTube ↗
                            </a>
                          </p>
                        ) : null}
                        <ol className="space-y-3">
                          {c.per_question.map((pq, i) => (
                            <li key={i} className="rounded-xl bg-white p-3 ring-1 ring-[var(--color-rule)]">
                              <div className="flex items-start justify-between gap-3">
                                <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
                                  Q{i + 1} · {pq.kind === "mc" ? "Multi-choice" : "Reflection"}
                                </div>
                                {pq.kind === "mc" ? (
                                  pq.correct ? (
                                    <span className="rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">
                                      Correct
                                    </span>
                                  ) : (
                                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-700">
                                      Wrong
                                    </span>
                                  )
                                ) : null}
                              </div>
                              <p className="mt-1.5 text-sm leading-snug text-[var(--color-ink)]">
                                {pq.question}
                              </p>
                              {pq.kind === "mc" ? (
                                <ul className="mt-2 space-y-1 text-xs">
                                  {pq.choices.map((choice) => {
                                    const isCorrect = choice === pq.correct_choice;
                                    const isKidChoice = choice === pq.kid_choice;
                                    return (
                                      <li
                                        key={choice}
                                        className={
                                          "flex items-start gap-2 rounded-md px-2 py-1 " +
                                          (isCorrect
                                            ? "bg-[var(--color-accent)]/10 text-[var(--color-ink)]"
                                            : isKidChoice
                                              ? "bg-red-50 text-[var(--color-ink)]"
                                              : "text-[var(--color-ink-soft)]")
                                        }
                                      >
                                        <span aria-hidden className="font-mono">
                                          {isCorrect ? "✓" : isKidChoice ? "✗" : "·"}
                                        </span>
                                        <span className="flex-1">{choice}</span>
                                        {isKidChoice ? (
                                          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-soft)]">
                                            kid picked
                                          </span>
                                        ) : null}
                                      </li>
                                    );
                                  })}
                                </ul>
                              ) : (
                                <div className="mt-2 rounded-md bg-[var(--color-cream)]/60 p-3 text-sm italic leading-snug text-[var(--color-ink)]">
                                  {pq.kid_answer
                                    ? `“${pq.kid_answer}”`
                                    : "(blank)"}
                                </div>
                              )}
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
