"use client";

/**
 * Tight inline email-capture for the hero. Same submit pathway as
 * <WaitlistForm> in the pricing section, but visually compact (single row on
 * desktop), no deposit pivot in success state — the upsell happens further
 * down on the pricing form. Goal: get the lowest-friction email above the
 * fold so paid-ad visitors convert before they ever scroll.
 */

import { useState } from "react";
import { sendGAEvent } from "@next/third-parties/google";

function fbqTrack(event: string, params?: Record<string, unknown>) {
  const w = window as typeof window & { fbq?: (...a: unknown[]) => void };
  if (typeof w.fbq === "function") w.fbq("track", event, params);
}

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function HeroWaitlist({ variationId }: { variationId: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [email, setEmail] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setState({ kind: "error", message: "Enter a valid email." });
      return;
    }
    setState({ kind: "submitting" });

    const payload = {
      email: trimmed,
      variation: variationId,
      source:
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search + "#hero"
          : "/#hero",
    };

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        sendGAEvent("event", "waitlist_error", {
          variation: variationId,
          status: res.status,
          source: "hero",
        });
        setState({
          kind: "error",
          message: body?.error ?? "Something went wrong. Try again.",
        });
        return;
      }
      sendGAEvent("event", "waitlist_submit", {
        variation: variationId,
        source: "hero",
      });
      sendGAEvent("event", "conversion", { variation: variationId });
      fbqTrack("Lead", { content_name: "waitlist", source: "hero" });
      setState({ kind: "success" });
    } catch {
      sendGAEvent("event", "waitlist_error", {
        variation: variationId,
        status: "network",
        source: "hero",
      });
      setState({
        kind: "error",
        message: "Network error. Try again.",
      });
    }
  }

  if (state.kind === "success") {
    return (
      <div className="mt-8 max-w-md rounded-2xl border border-[var(--color-rule)] bg-white p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5">
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4L8.5 12l6.8-6.7a1 1 0 0 1 1.4 0Z"
                clipRule="evenodd"
              />
            </svg>
          </span>
          <div>
            <p className="font-medium text-[var(--color-ink)]">
              You&apos;re on the list.
            </p>
            <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
              We&apos;ll email you before your batch ships in September.{" "}
              <a
                href="#waitlist"
                className="font-medium text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                Want to skip the line? Lock in your spot →
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 max-w-md">
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
        <label className="flex-1">
          <span className="sr-only">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-[var(--color-rule)] bg-white px-4 py-3.5 text-base outline-none transition focus:border-[var(--color-ink)]"
          />
        </label>
        <button
          type="submit"
          disabled={state.kind === "submitting"}
          data-cta="hero-inline"
          data-variation={variationId}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-lg bg-[var(--color-ink)] px-5 py-3.5 text-base font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)] disabled:opacity-60"
        >
          {state.kind === "submitting" ? "Saving…" : "Reserve my spot →"}
        </button>
      </div>
      {state.kind === "error" ? (
        <p className="mt-2 text-sm text-[var(--color-accent)]">
          {state.message}
        </p>
      ) : (
        <p className="mt-2.5 text-xs text-[var(--color-ink-soft)]">
          No charge today.{" "}
          <a
            href="#how-it-works"
            className="underline-offset-4 hover:text-[var(--color-ink)] hover:underline"
          >
            See how it works ↓
          </a>
        </p>
      )}
    </form>
  );
}
