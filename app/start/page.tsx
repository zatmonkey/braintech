// Dedicated paid-traffic landing for the Meta Leads campaign.
// Continues the UGC ad story ("For two years, I was losing him to a
// screen...") with a message-matched hero. ONE CTA only: email capture.
// Trust row below the fold: founder block + Bark/Circle comparison
// table. Testimonial block held back until we have real founding-family
// quotes — fabricated/styled quotes for this audience are a conversion
// killer and an FTC compliance risk under the 2024 Endorsement Guides.
//
// Variation pinning: this page renders variation 5 unconditionally and
// re-pins bt_var=5 via proxy.ts. ?variation=N still allows dev preview.

import { cookies, headers } from "next/headers";
import { HeroWaitlist } from "../hero-waitlist";
import { VariationTracker } from "../variation-tracker";
import { CancelTracker } from "../cancel-tracker";
import { ExitIntent } from "../exit-intent";
import { ChatWidget } from "../chat-widget";
import { getVariation } from "../variations";
import { pricingForCountry, discountedPurchase } from "../lib/pricing";
import { foundingScarcity } from "../lib/founding";
import type { Metadata } from "next";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const metadata: Metadata = {
  title: "Stop losing them to the screen — Braintech",
  description:
    "One small box. Text it your rules. Your kid earns TikTok, YouTube and Roblox by learning. Drop your email — save 10% on your founding spot.",
  // Paid landing pages should not be indexed; they only exist for the ad.
  robots: { index: false, follow: false },
};

export default async function Start({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
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
  const discounted = discountedPurchase(pricing, 10);

  return (
    <main
      className="flex flex-1 flex-col"
      data-variation={variation.id}
      data-page="start"
    >
      {/* Minimal header — logo only; no nav competing with the form. */}
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6">
        <a href="/" className="flex items-center gap-2" aria-label="Braintech">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt=""
            width={28}
            height={28}
            className="size-7 rounded-md"
          />
          <span className="font-semibold tracking-tight">braintech</span>
        </a>
      </header>

      {/* HERO. Single column on mobile; form above the fold on a 390px
          viewport (image pushed below). */}
      <section className="mx-auto w-full max-w-3xl px-6 pb-12 sm:pb-16">
        <div className="grid items-start gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
          <div className="fade-up">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-rule)] bg-white/60 px-3 py-1 text-xs font-medium text-[var(--color-ink-soft)]">
              <span className="size-1.5 rounded-full bg-[var(--color-accent)] pulse-dot" />
              {foundingScarcity()}
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
            <HeroWaitlist
              variation={variation}
              pricing={pricing}
              pageContext="start"
            />
          </div>

          {/* Hero photo lazy-loaded below the fold on mobile. Reserved
              aspect-ratio box prevents CLS. */}
          <div
            className="relative mx-auto w-full max-w-sm fade-up"
            style={{ animationDelay: "120ms" }}
          >
            <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-br from-[var(--color-accent)]/15 via-transparent to-[var(--color-ink)]/5 blur-2xl" />
            <div
              className="overflow-hidden rounded-[2rem] border border-[var(--color-rule)] bg-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)]"
              style={{ aspectRatio: "16/9" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/hero-mum-kitchen.webp"
                alt="A parent in a warm sunlit kitchen smiling as she reads her phone; her child reads a book in the soft-focus background; the Braintech device sits on a shelf behind her with a small glowing orange brain icon."
                width={1600}
                height={904}
                loading="lazy"
                decoding="async"
                className="block h-full w-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* TRUST ROW — founder + comparison. Testimonial block held back
          until we have real founding-family quotes (FTC + sniff-test
          reasons). When ready, add a <FoundingTestimonial /> here. */}
      <section className="mx-auto w-full max-w-3xl px-6 pb-16 sm:pb-24">
        <FounderBlock />
        <ComparisonTable
          braintechPrice={`${discounted.label.replace("/yr", "")}/yr`}
        />
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

      <VariationTracker variationId={variation.id} />
      <CancelTracker />
      <ExitIntent />
      <ChatWidget />
    </main>
  );
}

/* ──────────────────────── Trust row sub-components ─────────────────────── */

function FounderBlock() {
  return (
    <div className="mt-10 grid items-start gap-6 rounded-2xl border border-[var(--color-rule)] bg-white p-6 sm:grid-cols-[120px_1fr] sm:gap-7 sm:p-7">
      <div
        className="shrink-0 overflow-hidden rounded-2xl border border-[var(--color-rule)]"
        style={{ width: 120, height: 120 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/founder-alex.jpg"
          alt="Alex, founder of Braintech, at his kitchen counter texting a rule into the device."
          width={120}
          height={120}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      </div>
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-accent)]">
          From the founder
        </div>
        <p className="mt-2 text-[15px] leading-relaxed text-[var(--color-ink)]">
          Hi, I&rsquo;m Alex. I built Braintech after losing three Sunday
          afternoons to the same screen-time fight with my kid. I&rsquo;m a
          parent and a tech person, so I built the thing I needed: a small box
          that sits on your home Wi-Fi, listens to your text rules, and turns
          screen time into earned learning time. It works on every device
          without an app — so there&rsquo;s nothing on their phone to delete.
        </p>
        <p className="mt-3 text-sm font-medium text-[var(--color-ink)]">
          — Alex, founder · San Francisco
        </p>
      </div>
    </div>
  );
}

function ComparisonTable({ braintechPrice }: { braintechPrice: string }) {
  type Row = {
    label: string;
    braintech: "yes" | "no" | string;
    bark: "yes" | "no" | string;
    circle: "yes" | "no" | string;
  };
  const rows: Row[] = [
    {
      label: "Works on every device with NO apps to install",
      braintech: "yes",
      bark: "no",
      circle: "no",
    },
    {
      label: "Nothing on their phone for the kid to delete",
      braintech: "yes",
      bark: "no",
      circle: "no",
    },
    {
      label: "Earn-to-unlock learning (TED, Khan, reading)",
      braintech: "yes",
      bark: "no",
      circle: "no",
    },
    {
      label: "Year-one price (device + service)",
      braintech: braintechPrice,
      bark: "~$129 + $14/mo",
      circle: "~$129 + $129/yr",
    },
  ];
  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--color-rule)] bg-white">
      <div className="border-b border-[var(--color-rule)] px-6 py-5">
        <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-accent)]">
          How it compares
        </div>
        <h3 className="serif mt-2 text-2xl leading-snug">
          The other boxes block. Braintech teaches.
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-rule)] bg-[var(--color-cream)]/60 text-left text-xs uppercase tracking-wider text-[var(--color-ink-soft)]">
              <th scope="col" className="px-4 py-3 sm:px-6">
                {" "}
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-center font-semibold text-[var(--color-ink)] sm:px-6"
              >
                Braintech
              </th>
              <th scope="col" className="px-4 py-3 text-center sm:px-6">
                Bark Home
              </th>
              <th scope="col" className="px-4 py-3 text-center sm:px-6">
                Circle
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.label}
                className={i < rows.length - 1 ? "border-b border-[var(--color-rule)]" : ""}
              >
                <th
                  scope="row"
                  className="px-4 py-3 text-left text-[var(--color-ink)] sm:px-6 sm:py-4"
                >
                  {r.label}
                </th>
                <td className="px-4 py-3 text-center font-medium text-[var(--color-ink)] sm:px-6 sm:py-4">
                  <Cell value={r.braintech} accent />
                </td>
                <td className="px-4 py-3 text-center text-[var(--color-ink-soft)] sm:px-6 sm:py-4">
                  <Cell value={r.bark} />
                </td>
                <td className="px-4 py-3 text-center text-[var(--color-ink-soft)] sm:px-6 sm:py-4">
                  <Cell value={r.circle} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({
  value,
  accent = false,
}: {
  value: "yes" | "no" | string;
  accent?: boolean;
}) {
  if (value === "yes") {
    return (
      <span
        className={`inline-flex size-6 items-center justify-center rounded-full ${
          accent
            ? "bg-[var(--color-accent)] text-white"
            : "bg-[var(--color-ink)]/10 text-[var(--color-ink)]"
        }`}
        aria-label="Yes"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5">
          <path
            fillRule="evenodd"
            d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4L8.5 12l6.8-6.7a1 1 0 0 1 1.4 0Z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    );
  }
  if (value === "no") {
    return (
      <span
        className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--color-ink-soft)]/15 text-[var(--color-ink-soft)]"
        aria-label="No"
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          className="size-3.5"
        >
          <path d="M5 5l10 10M15 5L5 15" />
        </svg>
      </span>
    );
  }
  return <span className="text-xs sm:text-sm">{value}</span>;
}
