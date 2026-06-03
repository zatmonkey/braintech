import Stripe from "stripe";

let cached: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!cached) cached = new Stripe(key);
  return cached;
}

export const DEPOSIT_AMOUNT_CENTS = 5000; // $50 — refundable lock-in deposit
export const PURCHASE_AMOUNT_CENTS = 24900; // $249/yr — full founding membership
export const SHIP_DATE = "September 1";
