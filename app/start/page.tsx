// Dedicated paid-traffic landing. Stripped to ONE message + ONE action:
// match the IG ad copy verbatim ("Simplify parental controls / peace of
// mind") and capture an email. No nav, no chat widget, no testimonials
// grid, no FAQ — every distraction is a bounce risk.
//
// Variation pinning: this page renders variation 5 unconditionally.
// proxy.ts still tracks views into variation_views; the bt_var cookie is
// re-pinned to 5 here so any subsequent visit to / stays consistent.
// ?variation=N still overrides for previewing other variations on this
// page during dev.

import { cookies, headers } from "next/headers";
import { HeroWaitlist } from "../hero-waitlist";
import { FoundingToasts } from "../founding-stats";
import { VariationTracker } from "../variation-tracker";
import { CancelTracker } from "../cancel-tracker";
import { ExitIntent } from "../exit-intent";
import { getVariation } from "../variations";
import { pricingForCountry } from "../lib/pricing";
import type { Metadata } from "next";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const metadata: Metadata = {
  title: "Simplify parental controls — Braintech",
  description:
    "Manage every screen in your home with simple text commands. Drop your email — we'll let you know when the next batch is ready.",
  // Paid landing pages should not be indexed; they only exist for the ad.
  robots: { index: false, follow: false },
};

export default async function Start({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  // Always render variation 5 by default; allow override for dev preview.
  const variationKey = params.variation ?? "5";
  const variation = getVariation(variationKey);

  const cookieStore = await cookies();
  const hdrs = await headers();
  const countryOverride = Array.isArray(params.country)
    ? params.country[0]
    : params.country;
  const country =
    countryOverride ??
    cookieStore.get("bt_geo")?.value ??
    hdrs.get("x-vercel-ip-country") ??
    "US";
  const pricing = pricingForCountry(country);

  return (
    <main
      className="flex flex-1 flex-col"
      data-variation={variation.id}
      data-page="start"
    >
      {/* Minimal header — just the logo so visitors trust the brand exists
          without nav competing for attention. */}
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6">
        <a href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Braintech"
            width={28}
            height={28}
            className="size-7 rounded-md"
          />
          <span className="font-semibold tracking-tight">braintech</span>
        </a>
      </header>

      <section className="mx-auto w-full max-w-3xl px-6 pb-16 sm:pb-24">
        <div className="grid items-start gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
          <div className="fade-up">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-rule)] bg-white/60 px-3 py-1 text-xs font-medium text-[var(--color-ink-soft)]">
              <span className="size-1.5 rounded-full bg-[var(--color-accent)] pulse-dot" />
              {variation.eyebrow}
            </div>
            <h1 className="serif mt-6 text-[40px] leading-[1.02] tracking-[-0.02em] sm:text-6xl">
              {variation.headlineTop}
              <br />
              <em className="not-italic text-[var(--color-accent)]">
                {variation.headlineAccent}
              </em>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--color-ink-soft)]">
              {variation.subhead}
            </p>
            <HeroWaitlist variation={variation} pricing={pricing} />
          </div>

          {/* Product photo — anchors trust without pulling the visitor
              into a long scrolling story. */}
          <div
            className="relative mx-auto w-full max-w-sm fade-up"
            style={{ animationDelay: "120ms" }}
          >
            <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-br from-[var(--color-accent)]/15 via-transparent to-[var(--color-ink)]/5 blur-2xl" />
            <div className="overflow-hidden rounded-[2rem] border border-[var(--color-rule)] bg-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/hero-mum-kitchen.webp"
                alt="A parent in a warm sunlit kitchen smiling as she reads her phone; her child reads a book in the soft-focus background; the Braintech device sits on a shelf behind her with a small glowing orange brain icon."
                width={1600}
                height={904}
                loading="eager"
                fetchPriority="high"
                className="block h-full w-full"
              />
            </div>
          </div>
        </div>

        {/* Trust strip — calms the techy intimidation of cold paid traffic
            before they scroll past the form. */}
        <ul className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[var(--color-ink-soft)]">
          <li className="inline-flex items-center gap-2">
            <span aria-hidden className="size-1.5 rounded-full bg-[var(--color-accent)]" />
            30-day refund
          </li>
          <li className="inline-flex items-center gap-2">
            <span aria-hidden className="size-1.5 rounded-full bg-[var(--color-accent)]" />
            No app for your kid to delete
          </li>
          <li className="inline-flex items-center gap-2">
            <span aria-hidden className="size-1.5 rounded-full bg-[var(--color-accent)]" />
            Cancel any time
          </li>
        </ul>

        {/* One testimonial — US mom, our paid-traffic audience. */}
        <figure className="mt-10 rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)] p-6 sm:p-7">
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
            className="size-5 text-[var(--color-accent)]/70"
          >
            <path d="M7 4c-2 0-3.5 1.6-3.5 3.7v8.6c0 .9.7 1.7 1.7 1.7H10c.9 0 1.7-.7 1.7-1.7v-4.6c0-1-.7-1.7-1.7-1.7H7C7 6.9 8.2 6 9.4 6V4H7Zm10 0c-2 0-3.5 1.6-3.5 3.7v8.6c0 .9.7 1.7 1.7 1.7H20c.9 0 1.7-.7 1.7-1.7v-4.6c0-1-.7-1.7-1.7-1.7h-3c0-3.1 1.2-4 2.4-4V4h-2.4Z" />
          </svg>
          <blockquote className="mt-3 text-[17px] leading-relaxed text-[var(--color-ink)]">
            &ldquo;Bedtime used to be a 20-minute negotiation. Now I text Bri
            the rule once, and it just&hellip; runs. First quiet evening
            I&rsquo;ve had in years.&rdquo;
          </blockquote>
          <figcaption className="mt-4 flex items-center gap-3 border-t border-[var(--color-rule)] pt-4 text-sm">
            <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--color-ink)] text-sm font-semibold text-[var(--color-cream)]">
              S
            </div>
            <div className="leading-tight">
              <div className="font-semibold text-[var(--color-ink)]">
                Sarah W.
              </div>
              <div className="text-xs text-[var(--color-ink-soft)]">
                Mom of two · Austin, TX
              </div>
            </div>
          </figcaption>
        </figure>
      </section>

      <footer className="mt-auto bg-[var(--color-night)] text-[var(--color-cream)]/70">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-start justify-between gap-2 px-6 py-6 sm:flex-row">
          <p className="text-xs">
            © {new Date().getFullYear()} Braintech · Mutant Ventures LLC
          </p>
          <div className="flex gap-4 text-xs">
            <a href="/privacy" className="hover:text-[var(--color-cream)]">
              Privacy
            </a>
            <a href="/terms" className="hover:text-[var(--color-cream)]">
              SMS Terms
            </a>
            <a href="/" className="hover:text-[var(--color-cream)]">
              Learn more
            </a>
          </div>
        </div>
      </footer>

      <FoundingToasts />
      <VariationTracker variationId={variation.id} />
      <CancelTracker />
      <ExitIntent />
    </main>
  );
}
