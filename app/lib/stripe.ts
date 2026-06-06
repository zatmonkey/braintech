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
// bt_discount cookie matches this ID. Percent-off (not amount-off) so a
// single coupon works across all 8 currencies — amount_off coupons are
// currency-locked by Stripe.
//
// Configure per environment with STRIPE_DISCOUNT_COUPON_ID (prod uses the
// LIVE-mode coupon; dev/preview falls back to the test-mode coupon below).
// The cookie value is the coupon ID itself, so /api/checkout only honours
// it when it matches the *current* configured id — old cookies from
// retired promotions naturally stop applying anything.
export const DISCOUNT_COUPON_ID =
  process.env.STRIPE_DISCOUNT_COUPON_ID || "DzDs9Y3m";
export const DISCOUNT_COOKIE = "bt_discount";
export const DISCOUNT_PERCENT = 10;
