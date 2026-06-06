"use client";

/**
 * Phase-4 single-flow hero form:
 *   1. Visitor enters email.
 *   2. POST /api/waitlist — captures the lead AND sets the bt_discount
 *      cookie (so Stripe applies a 10% coupon on the next step).
 *   3. Success state shows the discount applied + a one-click button to
 *      Stripe Checkout at the discounted price.
 *
 * The old waitlist / deposit / buy-now branching is gone. Every variation
 * uses this same flow — only the headline / CTA copy varies.
 */

import { useEffect, useRef, useState } from "react";
import { sendGAEvent } from "@next/third-parties/google";
import type { Variation } from "./variations";
import {
  type Pricing,
  discountedPurchase,
} from "./lib/pricing";
import { stashCheckout } from "./lib/checkout-stash";

const DISCOUNT_PERCENT = 10;

function fbqTrack(
  event: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string },
) {
  const w = window as typeof window & { fbq?: (...a: unknown[]) => void };
  if (typeof w.fbq === "function") w.fbq("track", event, params, options);
}

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
}: {
  variation: Variation;
  pricing: Pricing;
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
    const payload = {
      email: trimmed,
      variation: variation.id,
      source:
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search + "#hero"
          : "/#hero",
      eventId,
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
      });
      sendGAEvent("event", "conversion", { variation: variation.id });
      fbqTrack(
        "Lead",
        { content_name: "discount", source: "hero", variation: variation.id },
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

  // Success-state CTA: opens Stripe checkout pre-filled with the email
  // the visitor just gave us, with the discount cookie already set so the
  // coupon applies server-side.
  async function orderWithCapturedEmail() {
    if (state.kind !== "success") return;
    const capturedEmail = state.email;
    setState({ kind: "checkingOut" });
    sendGAEvent("event", "hero_order_click", { variation: variation.id });
    fbqTrack("InitiateCheckout", {
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

  if (state.kind === "success" || state.kind === "checkingOut") {
    const checkingOut = state.kind === "checkingOut";
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
    <form onSubmit={onSubmit} className="mt-8 max-w-md">
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
          10% off your {pricing.purchaseLabel} order. Subscription starts the
          day your device ships. 30-day refund.
        </p>
      )}
    </form>
  );
}
