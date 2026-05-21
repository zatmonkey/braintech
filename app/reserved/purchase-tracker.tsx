"use client";

import { useEffect } from "react";

export function PurchaseTracker({ value = 50 }: { value?: number }) {
  useEffect(() => {
    const w = window as typeof window & { fbq?: (...a: unknown[]) => void };
    if (typeof w.fbq === "function") {
      w.fbq("track", "Purchase", {
        value,
        currency: "USD",
        content_name: "founding_device_deposit",
      });
    }
  }, [value]);
  return null;
}
