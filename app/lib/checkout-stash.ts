"use client";

/**
 * Tiny sessionStorage helper used by every component that opens a Stripe
 * Checkout session. Stashes the session context before we redirect so the
 * CancelTracker can fire abandonment events when the visitor lands back at
 * /?reserve=cancelled.
 *
 * sessionStorage scope is right: it survives the round-trip to Stripe and
 * back, but clears when the tab closes — abandoned sessions never persist.
 */

const KEY = "bt_checkout";

export type CheckoutStash = {
  sessionId: string;
  email: string;
  mode: "deposit" | "purchase";
  // value is in minor units (cents), matching Stripe's unit_amount.
  valueMinor: number;
  currency: string; // ISO 4217 lowercase
  variation: string | null;
  startedAt: number; // unix seconds
};

export function stashCheckout(s: CheckoutStash) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private-mode browsers throw; we just lose the abandonment signal.
  }
}

export function readStashedCheckout(): CheckoutStash | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CheckoutStash;
  } catch {
    return null;
  }
}

export function clearStashedCheckout() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
