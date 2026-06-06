import Stripe from "stripe";

let cached: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!cached) cached = new Stripe(key);
  return cached;
}

export const PURCHASE_AMOUNT_CENTS = 24900; // $249/yr — fallback only; localized pricing is in app/lib/pricing.ts.

// 10% off Stripe Coupon, duration=once. Applied at checkout when the
// bt_discount cookie matches. Percent-off (not amount-off) so a single
// coupon works across all 8 currencies — amount_off coupons are
// currency-locked by Stripe.
export const DISCOUNT_COUPON_ID = "DzDs9Y3m";
export const DISCOUNT_COOKIE = "bt_discount";
export const DISCOUNT_PERCENT = 10;
