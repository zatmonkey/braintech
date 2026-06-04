"use client";

/**
 * Detects landing-back-from-Stripe-cancel (URL contains ?reserve=cancelled)
 * and fires the abandonment events: fbq custom 'CheckoutCancelled' on the
 * browser, POST to /api/checkout/cancel which mirrors via CAPI.
 *
 * Reads the original session context from sessionStorage (set by
 * stashCheckout() before redirect to Stripe). Same event_id on both paths
 * means Meta dedupes, and we get full attribution coverage even when ad
 * blockers eat the browser fire.
 *
 * Cleans the URL after firing (history.replaceState) so a refresh doesn't
 * re-fire, and clears the sessionStorage entry too — once cancelled,
 * that checkout context is done.
 */

import { useEffect } from "react";
import { sendGAEvent } from "@next/third-parties/google";
import {
  readStashedCheckout,
  clearStashedCheckout,
} from "./lib/checkout-stash";

function fbqTrack(
  event: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string },
) {
  const w = window as typeof window & { fbq?: (...a: unknown[]) => void };
  if (typeof w.fbq === "function") w.fbq("track", event, params, options);
}

export function CancelTracker() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reserve") !== "cancelled") return;

    const stash = readStashedCheckout();

    // Best-effort browser fire — works even if we don't have the stash,
    // we just can't tag it with mode/value/variation in that case.
    fbqTrack(
      "CheckoutCancelled",
      stash
        ? {
            value:
              stash.currency.toLowerCase() === "jpy"
                ? stash.valueMinor
                : stash.valueMinor / 100,
            currency: stash.currency.toUpperCase(),
            content_ids: [
              stash.mode === "purchase"
                ? "founding-membership"
                : "deposit-spot",
            ],
            mode: stash.mode,
            variation: stash.variation ?? "unknown",
          }
        : undefined,
      stash ? { eventID: stash.sessionId } : undefined,
    );
    sendGAEvent("event", "checkout_cancelled", {
      variation: stash?.variation ?? "unknown",
      mode: stash?.mode ?? "unknown",
    });

    // Server-side CAPI mirror (only if we have the session context).
    if (stash) {
      fetch("/api/checkout/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: stash.sessionId,
          email: stash.email,
          mode: stash.mode,
          valueMinor: stash.valueMinor,
          currency: stash.currency,
          variation: stash.variation,
        }),
        keepalive: true,
      }).catch(() => {});
    }

    clearStashedCheckout();

    // Strip the ?reserve=cancelled param so a refresh doesn't re-fire.
    // Keep the #waitlist hash so PricingChoice's hash handler still works.
    params.delete("reserve");
    const search = params.toString();
    const hash = window.location.hash || "";
    const url = window.location.pathname + (search ? `?${search}` : "") + hash;
    history.replaceState(null, "", url);
  }, []);

  return null;
}
