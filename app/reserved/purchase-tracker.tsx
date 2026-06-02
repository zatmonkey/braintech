"use client";

import { useEffect } from "react";

/**
 * Meta Pixel Purchase event — fired once on /reserved when the Stripe
 * session confirms paid. Payload matches the catalog product id Meta
 * issued for the founding-deposit SKU so Events Manager attributes it
 * to the right campaign and Match Quality stays high.
 *
 * The base Pixel script loads with strategy="afterInteractive" in the
 * root layout, which is AFTER React hydrates and this useEffect runs.
 * So we may land here before window.fbq exists — poll every 200 ms for
 * up to 10 s. Guarded against double-fires via a window-level flag so
 * strict-mode dev re-renders and the poll-loop both can't fire it twice.
 */
export function PurchaseTracker({ value = 50 }: { value?: number }) {
  useEffect(() => {
    const w = window as typeof window & {
      fbq?: (...a: unknown[]) => void;
      __btPurchaseFired?: boolean;
    };
    if (w.__btPurchaseFired) return;
    const fire = () => {
      if (typeof w.fbq !== "function") return false;
      // NEXT_PUBLIC_META_TEST_EVENT_CODE routes events to Events
      // Manager → Test Events instead of normal attribution. Set it
      // while validating; unset it once production data should flow.
      const testCode = process.env.NEXT_PUBLIC_META_TEST_EVENT_CODE;
      w.fbq("track", "Purchase", {
        value,
        currency: "USD",
        contents: [{ id: "deposit-50", quantity: 1 }],
        ...(testCode ? { test_event_code: testCode } : {}),
      });
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
  }, [value]);
  return null;
}
