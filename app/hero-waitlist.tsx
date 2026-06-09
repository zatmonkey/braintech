"use client";

/**
 * Single-flow hero form. Two presentation modes:
 *
 *   pageContext="home"   → success swaps to "Your 10% off is ready" with a
 *                          one-click Stripe-checkout button (existing buy
 *                          flow on /).
 *   pageContext="start"  → success swaps to a calm "Check your inbox" block
 *                          + a Try-the-live-demo CTA + the founding-batch
 *                          ship line. The /start landing page is optimized
 *                          for Lead conversion; we don't push to Stripe on
 *                          the first commit.
 *
 * Tracking: fbq Lead fires ONLY on successful submit, with
 *  - advanced matching (hashed em re-init of the pixel)
 *  - eventID matched to the server-side CAPI fire from /api/waitlist
 *  - UTM params from the URL threaded through the lead payload so the
 *    backend can attribute leads per ad creative.
 */

import { useEffect, useRef, useState } from "react";
import { sendGAEvent } from "@next/third-parties/google";
import type { Variation } from "./variations";
import {
  type Pricing,
  discountedPurchase,
} from "./lib/pricing";
import { stashCheckout } from "./lib/checkout-stash";
import {
  readUtms,
  setAdvancedMatching,
  trackEvent,
} from "./lib/meta-pixel";
import { foundingShipMonth } from "./lib/founding";

const DISCOUNT_PERCENT = 10;

function newEventId(prefix: string): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; email: string }
  | { kind: "checkingOut" }
  | { kind: "error"; message: string };

export function HeroWaitlist({
  variation,
  pricing,
  pageContext = "home",
}: {
  variation: Variation;
  pricing: Pricing;
  pageContext?: "home" | "start";
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [email, setEmail] = useState("");
  const discounted = discountedPurchase(pricing, DISCOUNT_PERCENT);

  // Auto-focus the email field on mount. Skips iOS Safari (the keyboard
  // popping immediately on landing is jarring).
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const isIosSafari = /iP(hone|od|ad)/.test(navigator.userAgent);
    if (isIosSafari) return;
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setState({ kind: "error", message: "Enter a valid email." });
      return;
    }
    setState({ kind: "submitting" });

    // Generate a stable event_id so the browser fbq Lead and the server-side
    // CAPI Lead from /api/waitlist dedupe to one conversion in Meta.
    const eventId = newEventId("wl");
    const utms = readUtms();
    const payload = {
      email: trimmed,
      variation: variation.id,
      source:
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search + "#hero"
          : "/#hero",
      eventId,
      utms,
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
      sendGAEvent("event", "discount_claimed", {
        variation: variation.id,
        source: "hero",
        ...utms,
      });
      sendGAEvent("event", "conversion", { variation: variation.id });
      // Advanced matching: re-init the pixel with the hashed email so the
      // Lead event carries user_data Meta can match to a user even if
      // cookies are blocked. Awaited so the matching is set before track().
      await setAdvancedMatching({ email: trimmed });
      trackEvent(
        "Lead",
        {
          content_name: "discount",
          source: "hero",
          variation: variation.id,
          ...utms,
        },
        { eventID: eventId },
      );
      setState({ kind: "success", email: trimmed });
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

  // Success-state CTA (home only): opens Stripe checkout pre-filled with
  // the email we just captured.
  async function orderWithCapturedEmail() {
    if (state.kind !== "success") return;
    const capturedEmail = state.email;
    setState({ kind: "checkingOut" });
    sendGAEvent("event", "hero_order_click", { variation: variation.id });
    trackEvent("InitiateCheckout", {
      value: discounted.minor / (pricing.currency === "JPY" ? 1 : 100),
      currency: pricing.currency,
      variation: variation.id,
      source: "hero-success",
    });
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: capturedEmail,
          mode: "purchase",
          variation: variation.id,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        session_id?: string;
        value?: number;
        currency?: string;
      };
      if (data?.url) {
        if (data.session_id) {
          stashCheckout({
            sessionId: data.session_id,
            email: capturedEmail,
            mode: "purchase",
            valueMinor: data.value ?? discounted.minor,
            currency: data.currency ?? pricing.currency.toLowerCase(),
            variation: variation.id,
            startedAt: Math.floor(Date.now() / 1000),
          });
        }
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
  }

  function openDemo() {
    sendGAEvent("event", "demo_open_from_hero_success", {
      variation: variation.id,
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("braintech:open-demo"));
    }
  }

  if (state.kind === "success" || state.kind === "checkingOut") {
    const checkingOut = state.kind === "checkingOut";
    // /start: calm "check your inbox" confirmation + demo CTA + ship line.
    if (pageContext === "start") {
      return (
        <div className="mt-8 max-w-md rounded-2xl border border-[var(--color-rule)] bg-white p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
              <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
                <path
                  fillRule="evenodd"
                  d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4L8.5 12l6.8-6.7a1 1 0 0 1 1.4 0Z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
            <div>
              <p className="serif text-xl leading-snug text-[var(--color-ink)]">
                Check your inbox — your 10% code is on the way.
              </p>
              <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                {foundingShipMonth()}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={openDemo}
            data-cta="hero-success-demo"
            data-variation={variation.id}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-5 py-3 text-base font-medium text-white transition hover:brightness-95"
          >
            ▶ See exactly how it works — try the live demo
          </button>
          <p className="mt-3 text-center text-xs text-[var(--color-ink-soft)]">
            Text Bri a real screen-time rule. Watch what Braintech would do.
          </p>
        </div>
      );
    }

    // / (home): the Stripe upsell.
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
              Your 10% off is ready.
            </p>
            <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
              <span className="line-through opacity-60">
                {pricing.purchaseLabel}
              </span>{" "}
              <strong className="text-[var(--color-ink)]">
                {discounted.label}
              </strong>{" "}
              — applied at checkout. We&apos;ve also emailed it to you.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={orderWithCapturedEmail}
          disabled={checkingOut}
          data-cta="hero-success-order"
          data-variation={variation.id}
          className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-[var(--color-accent)] px-5 py-3 text-base font-medium text-white transition hover:brightness-95 disabled:opacity-60"
        >
          {checkingOut
            ? "Opening checkout…"
            : `Order yours — ${discounted.label} →`}
        </button>
        <p className="mt-2 text-center text-xs text-[var(--color-ink-soft)]">
          Your subscription starts the day your device ships. 30-day refund,
          cancel any time.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 max-w-md">
      {/* Value-prop chip above the form: the discounted price has to land
          BEFORE we ask for an email. */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm text-[var(--color-ink-soft)] line-through">
          {pricing.purchaseLabel}
        </span>
        <span className="serif text-2xl leading-none text-[var(--color-ink)]">
          {discounted.label}
        </span>
        <span className="rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">
          10% off · one email
        </span>
      </div>
      <form onSubmit={onSubmit}>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
          <label className="flex-1">
            <span className="sr-only">Email</span>
            <input
              ref={inputRef}
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
            data-cta="hero-discount"
            data-variation={variation.id}
            className="inline-flex items-center justify-center whitespace-nowrap rounded-lg bg-[var(--color-ink)] px-5 py-3.5 text-base font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)] disabled:opacity-60"
          >
            {state.kind === "submitting" ? "Sending…" : variation.cta}
          </button>
        </div>
        {state.kind === "error" ? (
          <p className="mt-2 text-sm text-[var(--color-accent)]">
            {state.message}
          </p>
        ) : (
          <p className="mt-2.5 text-xs text-[var(--color-ink-soft)]">
            Device included · 30-day refund · cancel anytime.
          </p>
        )}
      </form>
    </div>
  );
}
