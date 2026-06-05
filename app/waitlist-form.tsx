"use client";

import { useState } from "react";
import { sendGAEvent } from "@next/third-parties/google";
import type { Pricing } from "./lib/pricing";
import { stashCheckout } from "./lib/checkout-stash";

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
  | { kind: "success"; position?: number; email: string }
  | { kind: "error"; message: string };

export function WaitlistForm({
  compact = false,
  variationId,
  mode = "deposit",
  pricing,
}: {
  compact?: boolean;
  variationId: string;
  // "deposit"  = soft path: collect email → success state offers the $50
  //              lock-in upsell. (The name is historical — kept as default
  //              for backwards-compat with existing callers.)
  // "lockIn"   = direct path: email + button goes straight to deposit Stripe.
  //              No waitlist row, no upsell card — they already opted in.
  // "purchase" = full annual Stripe checkout (buy-now variation 6).
  mode?: "deposit" | "lockIn" | "purchase";
  pricing: Pricing;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [reserving, setReserving] = useState(false);

  async function startCheckout(
    email: string,
    checkoutMode: "deposit" | "purchase" = "deposit",
  ) {
    setReserving(true);
    sendGAEvent("event", "reserve_click", {
      variation: variationId,
      mode: checkoutMode,
    });
    const minor =
      checkoutMode === "purchase" ? pricing.purchaseMinor : pricing.depositMinor;
    fbqTrack("InitiateCheckout", {
      // FB expects value in major units. JPY is zero-decimal.
      value: pricing.currency === "JPY" ? minor : minor / 100,
      currency: pricing.currency,
      variation: variationId,
      mode: checkoutMode,
    });
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          mode: checkoutMode,
          variation: variationId,
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
            email,
            mode: checkoutMode,
            valueMinor:
              data.value ??
              (checkoutMode === "purchase"
                ? pricing.purchaseMinor
                : pricing.depositMinor),
            currency: data.currency ?? pricing.currency.toLowerCase(),
            variation: variationId,
            startedAt: Math.floor(Date.now() / 1000),
          });
        }
        window.location.href = data.url;
        return;
      }
    } catch {
      /* fall through to reset */
    }
    setReserving(false);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ kind: "submitting" });
    const form = e.currentTarget;
    const data = new FormData(form);
    // Same id sent client-side (fbq eventID) and server-side (CAPI event_id)
    // so Meta dedupes the Lead pair into a single conversion.
    const eventId = newEventId("wl");
    const payload = {
      email: String(data.get("email") ?? "").trim(),
      variation: variationId,
      source:
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : "/",
      eventId,
    };

    if (!payload.email || !payload.email.includes("@")) {
      setState({ kind: "error", message: "Enter a valid email." });
      return;
    }

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
        });
        setState({
          kind: "error",
          message: body?.error ?? "Something went wrong. Try again.",
        });
        return;
      }
      const body = await res.json().catch(() => ({}));
      sendGAEvent("event", "waitlist_submit", {
        variation: variationId,
        position: body?.position,
      });
      sendGAEvent("event", "conversion", {
        variation: variationId,
      });
      fbqTrack("Contact", { variation: variationId });
      fbqTrack(
        "Lead",
        { content_name: "waitlist", variation: variationId, source: "pricing" },
        { eventID: eventId },
      );
      setState({
        kind: "success",
        position: body?.position,
        email: payload.email,
      });
      form.reset();
    } catch {
      sendGAEvent("event", "waitlist_error", {
        variation: variationId,
        status: "network",
      });
      setState({
        kind: "error",
        message: "Network error. Try again.",
      });
    }
  }

  if (state.kind === "success") {
    return (
      <div
        className={`rounded-2xl border border-[var(--color-rule)] bg-white p-6 sm:p-8 ${
          compact ? "" : "shadow-[0_1px_0_rgba(0,0,0,0.04)]"
        }`}
      >
        <div className="inline-flex items-center gap-2 rounded-full bg-[var(--color-accent)]/10 px-3 py-1 text-xs font-medium text-[var(--color-accent)]">
          <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
          On the waitlist
        </div>
        <h3 className="serif mt-4 text-2xl leading-snug sm:text-3xl">
          The waitlist is free — but unordered.
        </h3>
        <p className="mt-2 text-[var(--color-ink-soft)]">
          We&apos;ll email you when the next batch is ready to ship — no
          guaranteed slot. Want a guaranteed device, ahead of everyone else?
          Drop a{" "}
          <strong>{pricing.depositLabel} refundable deposit</strong> and we
          lock one of the next 1,000 with your name on it. Ships{" "}
          <strong>worldwide September 1</strong>.
        </p>
        <button
          type="button"
          onClick={() => startCheckout(state.email, "deposit")}
          disabled={reserving}
          data-cta="reserve-deposit"
          data-variation={variationId}
          className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-[var(--color-accent)] px-6 py-3.5 text-base font-medium text-white transition hover:brightness-95 disabled:opacity-60"
        >
          {reserving
            ? "Taking you to checkout…"
            : `Lock in my device — ${pricing.depositLabel} deposit →`}
        </button>
        <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
          Secure checkout via Stripe. Refundable any time before your device
          ships. Credited toward your {pricing.purchaseLabel} founding
          membership.
        </p>
        <p className="mt-4 border-t border-[var(--color-rule)] pt-4 text-sm text-[var(--color-ink-soft)]">
          Not ready? You&apos;re still on the waitlist — we&apos;ll email you
          before the batch ships.
        </p>
      </div>
    );
  }

  // Direct lock-in: skip the waitlist row entirely. The visitor clicked
  // "Lock in your device" on the left card, so they're past the soft sell
  // — go straight from email to a $50 refundable Stripe deposit.
  if (mode === "lockIn") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          const email = String(formData.get("email") ?? "").trim();
          if (email && email.includes("@")) startCheckout(email, "deposit");
          else setState({ kind: "error", message: "Enter a valid email." });
        }}
        className={`rounded-2xl border border-[var(--color-rule)] bg-white p-6 sm:p-8 ${
          compact ? "" : "shadow-[0_1px_0_rgba(0,0,0,0.04)]"
        }`}
      >
        <input type="hidden" name="variation" value={variationId} />
        <div className="flex flex-col gap-3 sm:gap-4">
          <div className="inline-flex items-center gap-2 self-start rounded-full bg-[var(--color-accent)]/10 px-3 py-1 text-xs font-medium text-[var(--color-accent)]">
            <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
            Lock in your device
          </div>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
              Email
            </span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="mt-1.5 w-full rounded-lg border border-[var(--color-rule)] bg-[var(--color-cream)] px-4 py-3 text-base outline-none transition focus:border-[var(--color-ink)] focus:bg-white"
            />
          </label>
          <button
            type="submit"
            disabled={reserving}
            data-cta="lockin-submit"
            data-variation={variationId}
            className="mt-2 inline-flex items-center justify-center rounded-lg bg-[var(--color-accent)] px-6 py-3.5 text-base font-medium text-white transition hover:brightness-95 disabled:opacity-60"
          >
            {reserving
              ? "Opening checkout…"
              : `Continue to ${pricing.depositLabel} deposit →`}
          </button>
          {state.kind === "error" && (
            <p className="text-sm text-[var(--color-accent)]">{state.message}</p>
          )}
          <p className="text-xs text-[var(--color-ink-soft)]">
            {pricing.depositLabel} refundable any time before your device
            ships. Skips the queue; guarantees one of the next 1,000.
            Credited toward your {pricing.purchaseLabel} founding membership.
            Secure checkout via Stripe.
          </p>
        </div>
      </form>
    );
  }

  // Buy-now variation: the pricing form is a single $249/yr Stripe button.
  // No waitlist step, no deposit, no upsell — they came here to buy.
  if (mode === "purchase") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          const email = String(formData.get("email") ?? "").trim();
          if (email && email.includes("@")) startCheckout(email, "purchase");
          else setState({ kind: "error", message: "Enter a valid email." });
        }}
        className={`rounded-2xl border border-[var(--color-rule)] bg-white p-6 sm:p-8 ${
          compact ? "" : "shadow-[0_1px_0_rgba(0,0,0,0.04)]"
        }`}
      >
        <input type="hidden" name="variation" value={variationId} />
        <div className="flex flex-col gap-3 sm:gap-4">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
              Email
            </span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="mt-1.5 w-full rounded-lg border border-[var(--color-rule)] bg-[var(--color-cream)] px-4 py-3 text-base outline-none transition focus:border-[var(--color-ink)] focus:bg-white"
            />
          </label>
          <button
            type="submit"
            disabled={reserving}
            data-cta="purchase-submit"
            data-variation={variationId}
            className="mt-2 inline-flex items-center justify-center rounded-lg bg-[var(--color-accent)] px-6 py-3.5 text-base font-medium text-white transition hover:brightness-95 disabled:opacity-60"
          >
            {reserving
              ? "Opening checkout…"
              : `Buy now — ${pricing.purchaseLabel} →`}
          </button>
          {state.kind === "error" && (
            <p className="text-sm text-[var(--color-accent)]">{state.message}</p>
          )}
          <p className="text-xs text-[var(--color-ink-soft)]">
            Device included · ships worldwide September 1 · founding price
            locked at every renewal. Secure checkout via Stripe.
          </p>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className={`rounded-2xl border border-[var(--color-rule)] bg-white p-6 sm:p-8 ${
        compact ? "" : "shadow-[0_1px_0_rgba(0,0,0,0.04)]"
      }`}
    >
      <input type="hidden" name="variation" value={variationId} />
      <div className="flex flex-col gap-3 sm:gap-4">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
            Email
          </span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="mt-1.5 w-full rounded-lg border border-[var(--color-rule)] bg-[var(--color-cream)] px-4 py-3 text-base outline-none transition focus:border-[var(--color-ink)] focus:bg-white"
          />
        </label>
        <button
          type="submit"
          disabled={state.kind === "submitting"}
          data-cta="waitlist-submit"
          data-variation={variationId}
          className="mt-2 inline-flex items-center justify-center rounded-lg bg-[var(--color-ink)] px-6 py-3.5 text-base font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)] disabled:opacity-60"
        >
          {state.kind === "submitting"
            ? "Joining…"
            : "Join the waitlist — free →"}
        </button>
        {state.kind === "error" && (
          <p className="text-sm text-[var(--color-accent)]">{state.message}</p>
        )}
        <p className="text-xs text-[var(--color-ink-soft)]">
          Free to join — we email when devices ship. No order in the queue.
          Want yours guaranteed? Lock it in with a $50 refundable deposit on
          the next step.
        </p>
      </div>
    </form>
  );
}
