"use client";

/**
 * Soft last-ditch email capture for visitors about to bounce.
 *
 * Trigger heuristics:
 *  - Desktop: mouse leaves the viewport via the top edge (heading for the
 *    address bar / tab close).
 *  - Mobile (touch-only, no hover): after PASSIVE_TIMEOUT seconds of no
 *    scroll, no focus on a form input, no clicks. Catches the "passive
 *    browser about to put the phone down."
 *
 * Once-per-session via sessionStorage; if the visitor closed it once
 * we don't show again (respecting the "no thanks" signal). If they
 * actually submit, we also write to sessionStorage so future page loads
 * skip the prompt.
 *
 * Variation + Pixel/CAPI: piggybacks on the existing /api/waitlist Lead
 * stack — same event_id pattern, source = "exit-intent".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { sendGAEvent } from "@next/third-parties/google";

const SESSION_KEY = "bt_exit_intent_seen";
const PASSIVE_TIMEOUT_MS = 30_000;
// Don't fire the desktop mouseleave-top for the first N seconds. Without
// this, just landing on the page and reaching for the URL bar or tab
// strip fires the popup before the visitor has read anything.
const MOUSELEAVE_GRACE_MS = 15_000;

function fbqTrack(
  event: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string },
) {
  const w = window as typeof window & { fbq?: (...a: unknown[]) => void };
  if (typeof w.fbq === "function") w.fbq("track", event, params, options);
}

function newEventId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `xi_${crypto.randomUUID()}`;
  }
  return `xi_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function currentVariation(): string {
  const m = document.cookie.match(/(?:^|;\s*)bt_var=(\d+)/);
  return m?.[1] ?? "unknown";
}

type State =
  | { kind: "hidden" }
  | { kind: "open" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function ExitIntent() {
  const [state, setState] = useState<State>({ kind: "hidden" });
  const [email, setEmail] = useState("");
  // Track whether we've already armed the listeners. React Strict Mode
  // double-runs effects in dev, and we don't want to wire mouseleave twice.
  const armedRef = useRef(false);

  const open = useCallback(() => {
    setState((s) => {
      if (s.kind !== "hidden") return s;
      // Lock-in the sessionStorage immediately on first open. Without this,
      // a stray re-render / quick-dismiss / accidental fire could re-open
      // later in the same session. Once it's been shown once, it's done.
      try {
        sessionStorage.setItem(SESSION_KEY, "shown");
      } catch {
        /* private mode */
      }
      return { kind: "open" };
    });
  }, []);

  const dismiss = useCallback(() => {
    setState({ kind: "hidden" });
    try {
      sessionStorage.setItem(SESSION_KEY, "dismissed");
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    if (armedRef.current) return;
    armedRef.current = true;
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return; // already shown/dismissed/submitted
    } catch {
      /* ignore */
    }

    // Desktop only — mobile passive trigger was firing on engaged
    // visitors mid-read. Until we get a better mobile heuristic, only
    // desktop visitors see this. Mobile bouncers we accept losing.
    const hasHover = window.matchMedia("(hover: hover)").matches;
    if (!hasHover) return;

    const startedAt = performance.now();
    const onMouseLeave = (e: MouseEvent) => {
      if (e.clientY > 0) return; // not the top edge
      if (performance.now() - startedAt < MOUSELEAVE_GRACE_MS) return; // too early
      open();
    };
    document.addEventListener("mouseleave", onMouseLeave);

    return () => {
      document.removeEventListener("mouseleave", onMouseLeave);
      // Don't reset armedRef on cleanup — that would let it re-fire if React
      // re-mounts the component (which Strict Mode does in dev). Once a
      // session has armed the listeners, leave it armed.
    };
  }, [open]);

  // ESC closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state.kind === "open") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state.kind, dismiss]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setState({ kind: "error", message: "Enter a valid email." });
      return;
    }
    setState({ kind: "submitting" });
    const variation = currentVariation();
    const eventId = newEventId();
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          variation,
          source:
            window.location.pathname + window.location.search + "#exit-intent",
          eventId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setState({
          kind: "error",
          message: body?.error ?? "Something went wrong. Try again.",
        });
        return;
      }
      sendGAEvent("event", "waitlist_submit", {
        variation,
        source: "exit-intent",
      });
      sendGAEvent("event", "conversion", { variation });
      fbqTrack(
        "Lead",
        { content_name: "waitlist", source: "exit-intent", variation },
        { eventID: eventId },
      );
      try {
        sessionStorage.setItem(SESSION_KEY, "submitted");
      } catch {
        /* ignore */
      }
      setState({ kind: "success" });
    } catch {
      setState({ kind: "error", message: "Network error. Try again." });
    }
  }

  if (state.kind === "hidden") return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bt-exit-title"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        // Click outside the card dismisses, same as the close button.
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="relative w-full max-w-md rounded-2xl border border-[var(--color-rule)] bg-white p-6 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] sm:p-7">
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-[var(--color-ink-soft)] transition hover:bg-[var(--color-rule)]/40"
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

        {state.kind === "success" ? (
          <>
            <div className="grid size-10 place-items-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
              <svg viewBox="0 0 20 20" fill="currentColor" className="size-5">
                <path
                  fillRule="evenodd"
                  d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4L8.5 12l6.8-6.7a1 1 0 0 1 1.4 0Z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <h2
              id="bt-exit-title"
              className="serif mt-4 text-2xl leading-snug"
            >
              You&apos;re on the list.
            </h2>
            <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
              We&apos;ll email you the moment the next batch is ready.
            </p>
          </>
        ) : (
          <>
            <h2
              id="bt-exit-title"
              className="serif text-2xl leading-snug sm:text-3xl"
            >
              Before you go —
            </h2>
            <p className="mt-3 text-[var(--color-ink-soft)]">
              We&apos;ll let you know when the next batch is available. No
              charge today, no spam, one email when it&apos;s your turn.
            </p>
            <form onSubmit={submit} className="mt-5">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="flex-1 rounded-lg border border-[var(--color-rule)] bg-[var(--color-cream)] px-4 py-3 text-base outline-none transition focus:border-[var(--color-ink)] focus:bg-white"
                />
                <button
                  type="submit"
                  disabled={state.kind === "submitting"}
                  data-cta="exit-intent-submit"
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-lg bg-[var(--color-ink)] px-5 py-3 text-base font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)] disabled:opacity-60"
                >
                  {state.kind === "submitting" ? "Joining…" : "Notify me →"}
                </button>
              </div>
              {state.kind === "error" && (
                <p className="mt-2 text-sm text-[var(--color-accent)]">
                  {state.message}
                </p>
              )}
              <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
                You can unsubscribe any time. We&apos;ll only email about the
                device.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
