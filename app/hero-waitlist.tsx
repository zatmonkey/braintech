"use client";

/**
 * Tight inline above-the-fold capture. Two flavours, selected by the
 * variation's `mode` field:
 *
 *   - "waitlist" (default): email + "Join the waitlist — free" button. Same
 *      submit pathway as the larger <WaitlistForm>. Success state offers
 *      the $50 lock-in deposit as the upsell.
 *
 *   - "buyNow":  email + "Buy now — $249/yr →" button. POSTs straight to
 *      /api/checkout with mode=purchase and redirects to Stripe. No
 *      waitlist queue, no deposit; the visitor came here to buy.
 *
 * The deposit-upsell card lives down in the Pricing section for the
 * waitlist flavour, so cold paid traffic can convert above the fold without
 * being asked for $50.
 */

import { useState } from "react";
import { sendGAEvent } from "@next/third-parties/google";
import type { Variation } from "./variations";
import type { Pricing } from "./lib/pricing";

function fbqTrack(event: string, params?: Record<string, unknown>) {
  const w = window as typeof window & { fbq?: (...a: unknown[]) => void };
  if (typeof w.fbq === "function") w.fbq("track", event, params);
}

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" } // waitlist only — buyNow redirects, never lands here
  | { kind: "error"; message: string };

export function HeroWaitlist({
  variation,
  pricing,
}: {
  variation: Variation;
  pricing: Pricing;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [email, setEmail] = useState("");
  const isBuyNow = variation.mode === "buyNow";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setState({ kind: "error", message: "Enter a valid email." });
      return;
    }
    setState({ kind: "submitting" });

    if (isBuyNow) {
      // Skip the waitlist; go straight to a $249/yr Stripe checkout.
      sendGAEvent("event", "buy_now_click", {
        variation: variation.id,
        source: "hero",
      });
      fbqTrack("InitiateCheckout", {
        value: pricing.purchaseMinor / (pricing.currency === "JPY" ? 1 : 100),
        currency: pricing.currency,
        variation: variation.id,
        source: "hero",
      });
      try {
        const res = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: trimmed,
            mode: "purchase",
            variation: variation.id,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { url?: string };
        if (data?.url) {
          window.location.href = data.url;
          return;
        }
        setState({
          kind: "error",
          message: "Couldn't open checkout. Try again.",
        });
      } catch {
        setState({
          kind: "error",
          message: "Network error. Try again.",
        });
      }
      return;
    }

    // Waitlist flavour — soft email capture.
    const payload = {
      email: trimmed,
      variation: variation.id,
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
          variation: variation.id,
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
        variation: variation.id,
        source: "hero",
      });
      sendGAEvent("event", "conversion", { variation: variation.id });
      fbqTrack("Lead", { content_name: "waitlist", source: "hero" });
      setState({ kind: "success" });
    } catch {
      sendGAEvent("event", "waitlist_error", {
        variation: variation.id,
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
    // buyNow never reaches this — it window.location's to Stripe.
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
              You&apos;re on the waitlist.
            </p>
            <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
              The waitlist is free but unordered — we email when the first batch
              ships.{" "}
              <a
                href="#lockin"
                className="font-medium text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                Want to lock in your device? {pricing.depositLabel} holds your
                spot →
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  const buttonLabel = isBuyNow
    ? state.kind === "submitting"
      ? "Opening checkout…"
      : `Buy now — ${pricing.purchaseLabel} →`
    : state.kind === "submitting"
      ? "Joining…"
      : variation.cta;

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
          data-cta={isBuyNow ? "hero-buy-now" : "hero-waitlist"}
          data-variation={variation.id}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-lg bg-[var(--color-ink)] px-5 py-3.5 text-base font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)] disabled:opacity-60"
        >
          {buttonLabel}
        </button>
      </div>
      {state.kind === "error" ? (
        <p className="mt-2 text-sm text-[var(--color-accent)]">
          {state.message}
        </p>
      ) : (
        <p className="mt-2.5 text-xs text-[var(--color-ink-soft)]">
          {isBuyNow ? (
            <>
              Device included · ships Sept 1 · cancel any time.{" "}
              <a
                href="#how-it-works"
                className="underline-offset-4 hover:text-[var(--color-ink)] hover:underline"
              >
                See how it works ↓
              </a>
            </>
          ) : (
            <>
              No charge today.{" "}
              <a
                href="#lockin"
                className="underline-offset-4 hover:text-[var(--color-ink)] hover:underline"
              >
                Or lock your device in for {pricing.depositLabel} →
              </a>
            </>
          )}
        </p>
      )}
    </form>
  );
}
