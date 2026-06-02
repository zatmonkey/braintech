"use client";

import { useEffect } from "react";

/**
 * Meta Pixel Purchase event — fired once on /reserved when the Stripe
 * session confirms paid. Payload matches the catalog product id Meta
 * issued for the founding-deposit SKU so Events Manager attributes it
 * to the right campaign and Match Quality stays high.
 *
 * Guarded against double-fires inside a strict-mode dev re-render with
 * a window-level flag — useEffect alone runs twice in dev.
 */
export function PurchaseTracker({ value = 50 }: { value?: number }) {
  useEffect(() => {
    const w = window as typeof window & {
      fbq?: (...a: unknown[]) => void;
      __btPurchaseFired?: boolean;
    };
    if (w.__btPurchaseFired || typeof w.fbq !== "function") return;
    w.fbq("track", "Purchase", {
      value,
      currency: "USD",
      contents: [{ id: "deposit-50", quantity: 1 }],
    });
    w.__btPurchaseFired = true;
  }, [value]);
  return null;
}
