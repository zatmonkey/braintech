/**
 * Buy-now card used in the bottom Pricing section of `/`.
 *
 * Server-rendered shell + BuyButton client island. Same checkout path
 * as /buy — POST /api/checkout → Stripe — so paid-traffic, returning
 * visitors, and email-link recipients all land on a single instrumented
 * funnel.
 *
 * If the visitor has already claimed the 10% off (bt_discount cookie set
 * to the active coupon id), the card shows the discounted price + the
 * "10% off · locked in" badge so they don't have to scroll back to the
 * hero to see their savings.
 */
import type { Pricing } from "./lib/pricing";
import { discountedPurchase } from "./lib/pricing";
import { DISCOUNT_COUPON_ID } from "./lib/stripe";
import { BuyButton } from "./buy/buy-button";

const DISCOUNT_PERCENT = 10;

export function BuyNowCard({
  variation,
  pricing,
  discountActive,
}: {
  variation: string;
  pricing: Pricing;
  discountActive: boolean;
}) {
  const discounted = discountedPurchase(pricing, DISCOUNT_PERCENT);

  return (
    <div className="rounded-2xl border border-[var(--color-rule)] bg-white p-6 shadow-sm sm:p-7">
      {discountActive ? (
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[var(--color-accent)]/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
          <span>{DISCOUNT_PERCENT}% off</span>
          <span aria-hidden>·</span>
          <span>locked in</span>
        </div>
      ) : null}

      <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-ink-soft)]">
        Order now
      </p>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {discountActive ? (
          <>
            <span className="text-base text-[var(--color-ink-soft)] line-through">
              {pricing.purchaseLabel}
            </span>
            <span className="serif text-4xl leading-none text-[var(--color-ink)]">
              {discounted.label}
            </span>
          </>
        ) : (
          <span className="serif text-4xl leading-none text-[var(--color-ink)]">
            {pricing.purchaseLabel}
          </span>
        )}
      </div>

      <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
        Device included. Ships in <strong className="text-[var(--color-ink)]">4 weeks</strong>.
        Your subscription starts the day it&rsquo;s in your hands.
      </p>

      <div className="mt-5">
        <BuyButton
          variation={variation}
          prefilledEmail=""
          discountActive={discountActive}
          couponId={discountActive ? DISCOUNT_COUPON_ID : null}
          discountedLabel={discounted.label}
          fullLabel={pricing.purchaseLabel}
          currency={pricing.currency}
          discountedMinor={discounted.minor}
          fullMinor={pricing.purchaseMinor}
        />
      </div>

      <p className="mt-3 text-center text-xs text-[var(--color-ink-soft)]">
        Secure payment by Stripe · 30-day refund · Cancel any time before renewal.
      </p>
    </div>
  );
}
