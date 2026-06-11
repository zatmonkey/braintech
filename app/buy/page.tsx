/**
 * Dedicated buy page. Reached from:
 *   - the discount-confirmation email's "Order now" CTA
 *     → /buy?email=<them>&dc=<coupon>
 *   - any future direct-buy link / paid campaign
 *
 * Server-rendered shell (pricing + variation lookup mirror `app/page.tsx`)
 * with a small client island for the Stripe redirect. No nav, no chat,
 * no founding stats — just price + email + buy button. Reduces decision
 * friction for someone who already said "yes" by clicking the email.
 */
import { cookies, headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { pricingForCountry, discountedPurchase } from "../lib/pricing";
import { DISCOUNT_COUPON_ID } from "../lib/stripe";
import { getVariation } from "../variations";
import { BuyButton } from "./buy-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order your Braintech",
  description:
    "One device, every screen in the house. $249/yr. 30-day refund.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function strParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

const DISCOUNT_PERCENT = 10;

export default async function BuyPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const hdrs = await headers();

  // Variation precedence mirrors page.tsx so attribution survives a click
  // from the email all the way through to the Stripe metadata.
  const variationKey =
    strParam(params, "variation") ?? cookieStore.get("bt_var")?.value;
  const variation = getVariation(variationKey);

  // Geo for localised pricing.
  const countryOverride = strParam(params, "country");
  const country =
    countryOverride ??
    cookieStore.get("bt_geo")?.value ??
    hdrs.get("x-vercel-ip-country") ??
    "US";
  const pricing = pricingForCountry(country);

  // Prefill from the email link. We don't validate against the waitlist
  // table here — anyone who hits /buy with an email and the dc param gets
  // the same 10% off that anyone can claim by entering their email on the
  // landing page. There's no privileged offer to protect.
  const emailParam = (strParam(params, "email") ?? "").toLowerCase().trim();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailParam);
  const prefilledEmail = validEmail ? emailParam : "";

  // dc=<coupon> activates the 10%-off card. We accept the current coupon
  // only — old coupon ids silently drop to full price (same logic as
  // /api/checkout when reading the cookie).
  const dcParam = strParam(params, "dc") ?? "";
  const discountActive = dcParam === DISCOUNT_COUPON_ID;

  const discounted = discountedPurchase(pricing, DISCOUNT_PERCENT);

  return (
    <main className="min-h-dvh bg-[var(--color-paper)] px-4 py-10 md:py-16">
      <div className="mx-auto flex max-w-lg flex-col gap-6">
        <header className="text-center">
          <Link
            href="/"
            className="serif text-2xl tracking-tight text-[var(--color-ink)] hover:opacity-80"
          >
            Braintech
          </Link>
          <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
            Order your device — ships within{" "}
            <strong className="text-[var(--color-ink)]">4 weeks</strong>.
          </p>
        </header>

        <section className="rounded-2xl border border-[var(--color-rule)] bg-white p-6 shadow-sm">
          {discountActive ? (
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[var(--color-accent)]/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
              <span>{DISCOUNT_PERCENT}% off</span>
              <span aria-hidden>·</span>
              <span>locked in</span>
            </div>
          ) : null}

          <h1 className="serif text-2xl leading-tight text-[var(--color-ink)] md:text-3xl">
            Braintech — Year One
          </h1>

          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
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

          <ul className="mt-5 space-y-2 text-sm text-[var(--color-ink)]">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-[var(--color-accent)]">✓</span>
              <span>One device. Every screen in the house listens.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-[var(--color-accent)]">✓</span>
              <span>Text Bri a rule — she enforces it. No kids&rsquo; app to delete.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-[var(--color-accent)]">✓</span>
              <span>Kids earn time by passing quizzes on what they learned.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-[var(--color-accent)]">✓</span>
              <span>30-day refund. Cancel any time before renewal.</span>
            </li>
          </ul>

          <div className="mt-6">
            <BuyButton
              variation={variation.id}
              prefilledEmail={prefilledEmail}
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
            Your subscription starts the day your device ships. Secure
            payment by Stripe.
          </p>
        </section>

        <section className="text-center">
          <p className="text-sm text-[var(--color-ink-soft)]">
            Questions before you buy?{" "}
            <Link
              href="/"
              className="font-medium text-[var(--color-ink)] underline underline-offset-4"
            >
              See how it works →
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
