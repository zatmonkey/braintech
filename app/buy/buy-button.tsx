"use client";

/**
 * Client island for the /buy page.
 *
 * - Email input (prefilled from URL, editable in case the recipient is
 *   buying on a different device than the email link was sent to).
 * - One button → POST /api/checkout → window.location to Stripe.
 *
 * The discount coupon ID flows through the POST body as `coupon` (the
 * existing cookie fallback inside /api/checkout still works, but the
 * email-link recipient may not have the cookie set on this browser).
 */
import { useState } from "react";
import { sendGAEvent } from "@next/third-parties/google";
import {
  trackEvent,
  setAdvancedMatching,
  readUtms,
} from "@/app/lib/meta-pixel";
import { stashCheckout } from "@/app/lib/checkout-stash";

function newEventId(prefix: string): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

type Props = {
  variation: string;
  prefilledEmail: string;
  discountActive: boolean;
  couponId: string | null;
  discountedLabel: string;
  fullLabel: string;
  currency: string;
  discountedMinor: number;
  fullMinor: number;
};

type ButtonState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

export function BuyButton({
  variation,
  prefilledEmail,
  discountActive,
  couponId,
  discountedLabel,
  fullLabel,
  currency,
  discountedMinor,
  fullMinor,
}: Props) {
  const [email, setEmail] = useState(prefilledEmail);
  const [state, setState] = useState<ButtonState>({ kind: "idle" });

  const effectiveMinor = discountActive ? discountedMinor : fullMinor;
  const effectiveLabel = discountActive ? discountedLabel : fullLabel;

  async function onBuy() {
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setState({ kind: "error", message: "Enter a valid email." });
      return;
    }
    setState({ kind: "submitting" });

    const utms = readUtms();
    sendGAEvent("event", "buy_page_order_click", {
      variation,
      discount_active: discountActive,
      ...utms,
    });
    trackEvent(
      "InitiateCheckout",
      {
        value: effectiveMinor / (currency === "JPY" ? 1 : 100),
        currency,
        variation,
        source: "buy-page",
        discount_active: discountActive,
        ...utms,
      },
      { eventID: newEventId("buy") },
    );
    // Advanced-matching the pixel with the entered email — gives Meta a
    // stable user identifier even when third-party cookies are blocked.
    try {
      await setAdvancedMatching({ email: trimmed });
    } catch {
      // setAdvancedMatching is best-effort; never block checkout.
    }

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          mode: "purchase",
          variation,
          // Explicit coupon ID for the email-link path: the recipient
          // probably doesn't have bt_discount cookie set on this browser.
          // /api/checkout validates this against the active coupon id, so
          // forging an arbitrary coupon string here gets silently dropped.
          coupon: couponId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        session_id?: string;
        value?: number;
        currency?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        setState({
          kind: "error",
          message: data?.error ?? "Couldn't open checkout. Try again.",
        });
        return;
      }
      if (data.session_id) {
        stashCheckout({
          sessionId: data.session_id,
          email: trimmed,
          mode: "purchase",
          valueMinor: data.value ?? effectiveMinor,
          currency: (data.currency ?? currency).toLowerCase(),
          variation,
          startedAt: Math.floor(Date.now() / 1000),
        });
      }
      window.location.href = data.url;
    } catch {
      setState({ kind: "error", message: "Network error. Try again." });
    }
  }

  const submitting = state.kind === "submitting";

  return (
    <div className="flex flex-col gap-3">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--color-ink-soft)]">
          Your email
        </span>
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state.kind === "error") setState({ kind: "idle" });
          }}
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          className="block w-full rounded-lg border border-[var(--color-rule)] bg-white px-3 py-3 text-base text-[var(--color-ink)] outline-none transition focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/30"
        />
      </label>

      <button
        type="button"
        onClick={onBuy}
        disabled={submitting}
        data-cta="buy-page-order"
        data-variation={variation}
        className="inline-flex w-full items-center justify-center rounded-lg bg-[var(--color-accent)] px-5 py-3.5 text-base font-medium text-white transition hover:brightness-95 disabled:opacity-60"
      >
        {submitting ? "Opening checkout…" : `Order yours — ${effectiveLabel} →`}
      </button>

      {state.kind === "error" ? (
        <p
          className="text-center text-sm text-red-600"
          role="alert"
          aria-live="polite"
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
