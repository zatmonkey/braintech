"use client";

import { useEffect } from "react";

/**
 * Meta Pixel Purchase event — fired once on /reserved when Stripe confirms
 * the session is paid. The browser side is a best-effort signal that's easy
 * for ad blockers/iOS-restricted-tracking to drop; the authoritative
 * conversion record is fired server-side via the Conversions API in the
 * Stripe webhook (see app/api/stripe/webhook/route.ts → metaCapiPurchase).
 *
 * The base Pixel script loads with strategy="afterInteractive", so we may
 * land here before window.fbq exists — poll every 200 ms for up to 10 s.
 * Guarded by a window-level flag so React Strict Mode + the poll loop
 * can't fire the event twice.
 */
export function PurchaseTracker({
  value,
  currency,
  mode,
  variation,
  eventId,
}: {
  value: number; // major units (e.g. 50 for $50, 379 for AU$379)
  currency: string; // ISO 4217 uppercase
  mode: "deposit" | "purchase";
  variation: string | null;
  // Pixel ↔ CAPI dedup key. Same value sent both client- and server-side
  // means Meta counts it once. Stripe session id is perfect for this.
  eventId: string;
}) {
  useEffect(() => {
    const w = window as typeof window & {
      fbq?: (...a: unknown[]) => void;
      __btPurchaseFired?: boolean;
    };
    if (w.__btPurchaseFired) return;
    const fire = () => {
      if (typeof w.fbq !== "function") return false;
      const payload = {
        value,
        currency: currency.toUpperCase(),
        // content_ids/contents lets Meta group by SKU in reports.
        content_ids: [mode === "purchase" ? "year-one" : "reservation"],
        contents: [
          {
            id: mode === "purchase" ? "year-one" : "reservation",
            quantity: 1,
            item_price: value,
          },
        ],
        content_type: "product",
        // Custom params for breakdown / custom-conversion building in Meta.
        mode,
        variation: variation ?? "unknown",
      };
      // The 2nd-arg `{eventID}` is what Pixel uses to dedupe against CAPI.
      // Quirk of the JS lib: pass it via the optional third "eventID" key
      // on the params object OR via the 4th-arg trackSingle. Pixel-side
      // both are picked up by Events Manager.
      w.fbq("track", "Purchase", payload, { eventID: eventId });
      w.__btPurchaseFired = true;
      return true;
    };
    if (fire()) return;
    let attempts = 0;
    const id = setInterval(() => {
      attempts += 1;
      if (fire() || attempts >= 50) clearInterval(id);
    }, 200);
    return () => clearInterval(id);
  }, [value, currency, mode, variation, eventId]);
  return null;
}
