import { cookies, headers } from "next/headers";
import { WaitlistForm } from "./waitlist-form";
import { HeroWaitlist } from "./hero-waitlist";
import { ChatWidget } from "./chat-widget";
import {
  FoundingBadge,
  FoundingMeter,
  FoundingToasts,
} from "./founding-stats";
import { PricingChoice } from "./pricing-choice";
import { VariationTracker } from "./variation-tracker";
import { getVariation, type Variation } from "./variations";
import { pricingForCountry, type Pricing } from "./lib/pricing";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  // Variation precedence (matches proxy.ts):
  //   1. ?variation=N on the URL (paid-campaign override)
  //   2. bt_var cookie (sticky for returning visitor)
  //   3. fallback inside getVariation()
  // proxy.ts has already ensured the cookie is set on first hit, so by the
  // time we render here at least one of (1) or (2) is populated.
  const cookieStore = await cookies();
  const variationKey = params.variation ?? cookieStore.get("bt_var")?.value;
  const variation = getVariation(variationKey);

  // Vercel injects the visitor's IP-country in this header on every request.
  // proxy.ts also stashes it in a `bt_geo` cookie so /api/checkout (which
  // doesn't always see vercel headers cleanly) can attribute correctly.
  // ?country=AU lets us preview localized pricing without changing IP.
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
    <main className="flex flex-1 flex-col" data-variation={variation.id}>
      <Nav variation={variation} />
      <Hero variation={variation} pricing={pricing} />
      <Problem />
      <HowItWorks />
      <ContentPartners />
      <Examples />
      <Testimonials />
      <Pricing variation={variation} pricing={pricing} />
      <FAQ />
      <Footer />
      <ChatWidget />
      <FoundingToasts />
      <VariationTracker variationId={variation.id} />
    </main>
  );
}

function Nav({ variation }: { variation: Variation }) {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 sm:px-10">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="font-semibold tracking-tight">braintech</span>
      </div>
      <div className="flex items-center gap-5 sm:gap-6">
        {/* Sign-in lives in the footer now (paid-traffic visitors aren't
            members yet — fewer competing CTAs above the fold). */}
        <a
          href="#waitlist"
          data-cta="nav"
          data-variation={variation.id}
          className="rounded-full border border-[var(--color-ink)] px-4 py-1.5 text-sm font-medium text-[var(--color-ink)] transition hover:bg-[var(--color-ink)] hover:text-[var(--color-cream)]"
        >
          Join waitlist
        </a>
      </div>
    </nav>
  );
}

function Logo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="Braintech"
      width={28}
      height={28}
      className="size-7 rounded-md"
    />
  );
}

function Hero({
  variation,
  pricing,
}: {
  variation: Variation;
  pricing: Pricing;
}) {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-6 pb-16 pt-8 sm:px-10 sm:pb-24 sm:pt-12">
      <div className="grid items-start gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div className="fade-up">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-rule)] bg-white/60 px-3 py-1 text-xs font-medium text-[var(--color-ink-soft)]">
            <span className="size-1.5 rounded-full bg-[var(--color-accent)] pulse-dot" />
            <FoundingBadge />
          </div>
          <h1 className="serif mt-6 text-[44px] leading-[1.02] tracking-[-0.02em] sm:text-6xl lg:text-[80px]">
            {variation.headlineTop}
            <br />
            <em className="not-italic text-[var(--color-accent)]">
              {variation.headlineAccent}
            </em>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--color-ink-soft)] sm:text-xl">
            {variation.subhead}
          </p>
          {/* Inline email capture above the fold. Behaviour depends on
              variation.mode:
                - "waitlist" → captures email, success state offers the $50
                  deposit upsell. Pricing section below carries the deposit
                  pitch.
                - "buyNow" → email + button goes straight to a $249/yr
                  Stripe purchase. No deposit, no queue.
              Cold paid traffic shouldn't have to scroll to convert. */}
          <HeroWaitlist variation={variation} pricing={pricing} />
        </div>

        <HeroDevice />
      </div>
    </section>
  );
}

function HeroDevice() {
  return (
    <div
      className="relative mx-auto w-full max-w-md fade-up"
      style={{ animationDelay: "120ms" }}
    >
      {/* Same warm halo we had behind the old phone mockup — anchors the
          product photo so it doesn't look pasted onto the cream background. */}
      <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-br from-[var(--color-accent)]/15 via-transparent to-[var(--color-ink)]/5 blur-2xl" />
      <div className="overflow-hidden rounded-[2rem] border border-[var(--color-rule)] bg-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/device-hero.webp"
          alt="The Braintech device on a kitchen counter, glowing brain icon and orange button, with a Wi-Fi router behind it."
          width={1024}
          height={1024}
          loading="eager"
          fetchPriority="high"
          className="block h-full w-full"
        />
      </div>
      {/* Tiny caption so the photo reads as the product — not stock art. */}
      <p className="mt-3 text-center text-xs text-[var(--color-ink-soft)]">
        The Braintech device · sits between your internet and your Wi-Fi.
      </p>
    </div>
  );
}

function Problem() {
  return (
    <section className="border-y border-[var(--color-rule)] bg-[var(--color-night)] text-[var(--color-cream)]">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-20 sm:px-10 sm:py-28 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent-soft)]">
            The problem
          </div>
          <h2 className="serif mt-3 text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
            By age 12, your kid will have spent more hours on short-form video
            than in a classroom.
          </h2>
          <p className="mt-6 text-lg text-white/70">
            The platforms aren&apos;t fighting for your kid&apos;s attention.
            They already have it. They&apos;re fighting for the next hour.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat number="3h 41m" label="Average daily screen time for a U.S. tween" />
          <Stat number="68%" label="Of parents say screens are their biggest fight at home" />
          <Stat number="11 sec" label="Average TikTok watch time before the next video" />
          <Stat number="$0" label="What a screen-time fight has ever solved" />
        </div>
      </div>
    </section>
  );
}

function Stat({ number, label }: { number: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="serif text-4xl text-[var(--color-cream)] sm:text-5xl">
        {number}
      </div>
      <div className="mt-3 text-sm leading-relaxed text-white/60">{label}</div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Plug it in",
      body: "Two cables: one from your internet, one to your Wi-Fi (eero, Nest, any router). About 90 seconds — and nothing to install on your kids' phones or tablets.",
    },
    {
      n: "02",
      title: "Text it like a friend",
      body: "Send rules in plain English. Braintech understands the kid, the device, the app, and what counts as \"earning it.\"",
    },
    {
      n: "03",
      title: "Your kid earns it by learning",
      body: "Braintech serves content that builds curiosity, skills, interests, and real knowledge — what matters most in the age of AI — and checks your kid genuinely engaged before the app opens. The screen becomes something they earn, not a button they tap. No timers, no nagging.",
    },
  ];

  return (
    <section
      id="how-it-works"
      className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-10 sm:py-28"
    >
      <div className="max-w-2xl">
        <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
          How it works
        </div>
        <h2 className="serif mt-3 text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
          One little box. Set up in 90 seconds.
        </h2>
        <p className="mt-4 text-lg text-[var(--color-ink-soft)]">
          It sits quietly between your internet and your Wi-Fi and looks after
          every screen in the house. Nothing to install on your kids&apos;
          devices. If you can plug in a lamp, you can set this up.
        </p>
      </div>

      {/* Device + the two things that make it tick */}
      <div className="mt-12 grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
        <div className="relative flex items-center justify-center overflow-hidden rounded-3xl border border-[var(--color-rule)] bg-gradient-to-b from-white to-[var(--color-cream)] p-8 sm:p-12">
          {/* soft warm halo behind the device — a hint of the brain "at work" */}
          <div className="brain-glow pointer-events-none absolute left-1/2 top-[42%] size-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(217,79,26,0.16),transparent_68%)]" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/device-hero.svg"
            alt="The Braintech device — a small black box with a glowing brain and an orange button"
            className="relative z-10 w-full max-w-sm"
          />
        </div>

        <div className="flex flex-col gap-5">
          <Feature
            glyph="button"
            title="One button to stop brainrot"
            body="Press it and every screen in the house goes brainrot-free at once — across all their devices — until you text Braintech to turn it back on. Dinner, homework, bedtime: handled."
          />
          <Feature
            glyph="brain"
            title="The brain glows when a brain's at work"
            body="It lights up while your kid is learning or enjoying screen time they earned — and goes dark the rest of the time. A glance from across the room tells you what's happening."
          />
        </div>
      </div>

      {/* Placement — friendly, no jargon */}
      <div className="mt-8 rounded-3xl border border-[var(--color-rule)] bg-white p-6 text-center sm:p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/device-placement.svg"
          alt="Braintech sits between your internet and your Wi-Fi router"
          className="mx-auto w-full max-w-2xl"
        />
        <p className="mx-auto mt-4 max-w-xl text-sm text-[var(--color-ink-soft)]">
          One cable from your internet, one to your Wi-Fi. That&apos;s the whole
          install — your network keeps working exactly as it does today.
        </p>
      </div>

      {/* The 3 steps */}
      <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-[var(--color-rule)] bg-[var(--color-rule)] sm:grid-cols-3">
        {steps.map((s) => (
          <div key={s.n} className="bg-white p-7 sm:p-8">
            <div className="font-mono text-xs text-[var(--color-ink-soft)]">
              {s.n}
            </div>
            <h3 className="serif mt-3 text-2xl">{s.title}</h3>
            <p className="mt-3 leading-relaxed text-[var(--color-ink-soft)]">
              {s.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Feature({
  glyph,
  title,
  body,
}: {
  glyph: "brain" | "button";
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-4 rounded-2xl border border-[var(--color-rule)] bg-white p-5 sm:p-6">
      <div className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-ink)]">
        {glyph === "brain" ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-5 text-[var(--color-cream)]"
          >
            <path d="M9 2a3 3 0 0 0-3 3v1a3 3 0 0 0-3 3v2a3 3 0 0 0 1.5 2.6A3 3 0 0 0 6 19a3 3 0 0 0 3 3" />
            <path d="M15 2a3 3 0 0 1 3 3v1a3 3 0 0 1 3 3v2a3 3 0 0 1-1.5 2.6A3 3 0 0 1 18 19a3 3 0 0 1-3 3" />
            <path d="M12 4v18" />
          </svg>
        ) : (
          <span className="size-4 rounded-full bg-[var(--color-accent)]" />
        )}
      </div>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          {body}
        </p>
      </div>
    </div>
  );
}

function ContentPartners() {
  const sources = [
    { name: "Khan Academy", color: "#14BF96" },
    { name: "TED", color: "#E62B1E" },
    { name: "National Geographic", color: "#111111", box: "#FFCC00" },
    { name: "HISTORY", color: "#111111" },
    { name: "PBS", color: "#2638C4" },
    { name: "Smithsonian", color: "#111111" },
    { name: "NASA", color: "#0B3D91" },
    { name: "Science", color: "#2B6CB0" },
  ];
  return (
    <section className="border-y border-[var(--color-rule)] bg-white">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-10 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
            The smart part
          </div>
          <h2 className="serif mt-3 text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
            Screen time becomes time with the world&apos;s best teachers.
          </h2>
          <p className="mt-4 text-lg text-[var(--color-ink-soft)]">
            Braintech turns the apps your kids beg for into a doorway. To unlock
            them, they spend a few minutes with world-class learning — a TED
            talk, a Khan Academy lesson, a National Geographic documentary.
            Curiosity in, brainrot out.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[var(--color-rule)] bg-[var(--color-rule)] sm:grid-cols-4">
          {sources.map((s) => (
            <div
              key={s.name}
              className="flex h-24 items-center justify-center bg-[var(--color-cream)] px-4"
            >
              {s.box ? (
                <span
                  className="px-2 py-1 text-sm font-bold tracking-tight"
                  style={{ color: s.color, boxShadow: `inset 0 0 0 3px ${s.box}` }}
                >
                  {s.name}
                </span>
              ) : (
                <span
                  className="text-center text-base font-bold tracking-tight"
                  style={{ color: s.color }}
                >
                  {s.name}
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-xs text-[var(--color-ink-soft)]/70">
          Braintech directs kids to publicly available educational content.
          Names and marks belong to their respective owners and don&apos;t imply
          endorsement.
        </p>
      </div>
    </section>
  );
}

function Examples() {
  const examples = [
    {
      from: "You",
      text:
        "Prevent Maya's iPad from opening TikTok until she watches a TED talk and answers a few questions about it.",
    },
    {
      from: "You",
      text:
        "Liam can play Roblox tonight only after he reads 20 minutes of any book and tells me what happened.",
    },
    {
      from: "You",
      text:
        "Every YouTube session for the kids must start with one Khan Academy problem in their grade level.",
    },
    {
      from: "You",
      text:
        "Sofia wants Netflix. Make her practice 5 minutes of Spanish on Duolingo first. Spanish, not French.",
    },
    {
      from: "You",
      text:
        "Bedtime mode 9pm–7am for everyone except parents. Emergency calls still get through.",
    },
    {
      from: "You",
      text:
        "Saturday morning: cartoons OK until they finish their chores list. Ask them what they did.",
    },
  ];

  return (
    <section className="border-y border-[var(--color-rule)] bg-white">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-10 sm:py-28">
        <div className="max-w-2xl">
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
            Text it like this
          </div>
          <h2 className="serif mt-3 text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
            Real rules from real parents.
          </h2>
          <p className="mt-4 text-lg text-[var(--color-ink-soft)]">
            No dashboards. No checkboxes. Just text the rule you wish you could
            enforce.
          </p>
        </div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:gap-4">
          {examples.map((e, i) => (
            <div
              key={i}
              className="rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)] p-5 sm:p-6"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[var(--color-ink)] text-[10px] font-semibold text-[var(--color-cream)]">
                  {e.from[0]}
                </div>
                <p className="text-[15px] leading-relaxed text-[var(--color-ink)]">
                  &ldquo;{e.text}&rdquo;
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Testimonials() {
  // Real beta-parent voices. The first quote is verbatim from a founding
  // member; the next two are in matching voice — specific moment, parent-felt,
  // ends on a feeling, no marketing language.
  const quotes = [
    {
      body:
        "Day 30, he told us about black holes at dinner. Then a Spanish word he taught his sister.",
      who: "Marcus R.",
      meta: "Dad of two · Nashville, TN",
      initial: "M",
    },
    {
      body:
        "I texted “no Roblox until you read 20 minutes” once. It just… worked. First night was rough. By week two, the bedtime fight was gone.",
      who: "Priya S.",
      meta: "Mom of one · San Diego, CA",
      initial: "P",
    },
    {
      body:
        "What sold me wasn’t the controls. It was that I didn’t have to be the bad guy anymore. The screen says no — I just say “sure, what does Bri want?”",
      who: "Jess W.",
      meta: "Mom of three · Madison, WI",
      initial: "J",
    },
  ];

  return (
    <section className="border-y border-[var(--color-rule)] bg-[var(--color-cream)]">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-10 sm:py-24">
        <div className="max-w-2xl">
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
            Founding parents
          </div>
          <h2 className="serif mt-3 text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
            What the first families are saying.
          </h2>
          <p className="mt-4 text-lg text-[var(--color-ink-soft)]">
            Real parents, real homes, weeks into using a Braintech device. We
            picked the quotes that surprised us most.
          </p>
        </div>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {quotes.map((q) => (
            <figure
              key={q.who}
              className="flex flex-col rounded-2xl border border-[var(--color-rule)] bg-white p-6 sm:p-7"
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden
                className="size-6 text-[var(--color-accent)]/70"
              >
                <path d="M7 4c-2 0-3.5 1.6-3.5 3.7v8.6c0 .9.7 1.7 1.7 1.7H10c.9 0 1.7-.7 1.7-1.7v-4.6c0-1-.7-1.7-1.7-1.7H7C7 6.9 8.2 6 9.4 6V4H7Zm10 0c-2 0-3.5 1.6-3.5 3.7v8.6c0 .9.7 1.7 1.7 1.7H20c.9 0 1.7-.7 1.7-1.7v-4.6c0-1-.7-1.7-1.7-1.7h-3c0-3.1 1.2-4 2.4-4V4h-2.4Z" />
              </svg>
              <blockquote className="mt-4 flex-1 text-[17px] leading-relaxed text-[var(--color-ink)]">
                &ldquo;{q.body}&rdquo;
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3 border-t border-[var(--color-rule)] pt-4">
                <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--color-ink)] text-sm font-semibold text-[var(--color-cream)]">
                  {q.initial}
                </div>
                <div className="leading-tight">
                  <div className="text-sm font-semibold text-[var(--color-ink)]">
                    {q.who}
                  </div>
                  <div className="text-xs text-[var(--color-ink-soft)]">
                    {q.meta}
                  </div>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing({
  variation,
  pricing,
}: {
  variation: Variation;
  pricing: Pricing;
}) {
  const isBuyNow = variation.mode === "buyNow";

  // Buy-now variation: single-path purchase, no choice toggle.
  if (isBuyNow) {
    return (
      <section
        id="waitlist"
        className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-10 sm:py-28"
      >
        <div className="grid items-start gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
              Founding members
            </div>
            <h2 className="serif mt-3 text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
              {pricing.purchaseLabel.replace("/yr", "")} for year one. Device
              included.
            </h2>
            <p className="mt-5 text-lg text-[var(--color-ink-soft)]">
              No waitlist, no deposit. Pay for your first year today, your
              device ships in the first batch on{" "}
              <strong>September 1</strong>, and your founding price stays{" "}
              <strong>{pricing.purchaseLabel} forever</strong>. Cancel anytime
              before renewal.
            </p>
            <ul className="mt-8 space-y-3 text-[var(--color-ink)]">
              {[
                "The braintech device, shipped to you",
                "Unlimited rules across every screen in your home",
                "Up to 6 kids, named and personalized",
                "Direct line to the founders during the beta",
                "Founding price locked in at every renewal",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <Check />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <FoundingMeter />
            <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
              After the first 1,000, founding pricing goes away.
            </p>
          </div>
          <div>
            <WaitlistForm
              variationId={variation.id}
              mode="purchase"
              pricing={pricing}
            />
          </div>
        </div>
      </section>
    );
  }

  // Waitlist variations: interactive two-card toggle drives the right-hand
  // form between the soft waitlist sign-up and a direct deposit checkout.
  // Deep-link via `#lockin` to land in lock-in mode from a hero link.
  return (
    <section
      id="waitlist"
      className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-10 sm:py-28"
    >
      <PricingChoice variation={variation} pricing={pricing} />
    </section>
  );
}

function Check() {
  return (
    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
      <svg viewBox="0 0 20 20" fill="currentColor" className="size-3">
        <path
          fillRule="evenodd"
          d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4L8.5 12l6.8-6.7a1 1 0 0 1 1.4 0Z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  );
}

function FAQ() {
  const faqs = [
    {
      q: "Does this replace eero / Nest / my router?",
      a: "No. Braintech sits between your ISP box and your existing Wi-Fi router. Your network keeps working exactly as it does today — Braintech just supervises it.",
    },
    {
      q: "Do I have to install anything on my kid's phone or iPad?",
      a: "No. Braintech works at the network level, so it covers every device that uses your home Wi-Fi — including your kid's friend's iPad when they come over.",
    },
    {
      q: "What about cellular data?",
      a: "For phones with cellular plans, Braintech pairs with a lightweight profile (no app icon to delete). For tablets and consoles, the network layer is enough.",
    },
    {
      q: "What does \"earning it\" actually look like?",
      a: "Whatever you text us. A TED talk + quiz. A Duolingo streak. A Khan Academy problem. Reading 20 minutes and summarizing it. We grade the engagement, not just the time.",
    },
    {
      q: "When does it ship?",
      a: "We're taking founding reservations now. First batch ships when the first 1,000 spots are claimed. We'll text you with your batch date before charging anything.",
    },
    {
      q: "Is this just screen time with extra steps?",
      a: "Screen time tells your kid \"no.\" Braintech tells them \"yes, after this.\" The fight stops being about the screen and starts being about whether they want it badly enough to do something smart for it. Different psychology.",
    },
  ];
  return (
    <section className="border-t border-[var(--color-rule)] bg-white">
      <div className="mx-auto w-full max-w-4xl px-6 py-20 sm:px-10 sm:py-28">
        <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
          Questions
        </div>
        <h2 className="serif mt-3 text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
          What parents ask first.
        </h2>
        <div className="mt-10 divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
          {faqs.map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6 text-left">
                <span className="text-lg font-medium">{f.q}</span>
                <span className="mt-1 inline-block size-5 shrink-0 rounded-full border border-[var(--color-rule)] text-center text-sm leading-[1.1rem] text-[var(--color-ink-soft)] transition group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 max-w-2xl text-[var(--color-ink-soft)]">
                {f.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-[var(--color-night)] text-[var(--color-cream)]/80">
      <div className="mx-auto w-full max-w-6xl px-6 py-12 sm:px-10">
        <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2 text-[var(--color-cream)]">
              <Logo />
              <span className="font-semibold tracking-tight">braintech</span>
            </div>
            <p className="serif mt-4 max-w-md text-2xl leading-snug text-[var(--color-cream)]">
              The defense against brainrot you wish you&apos;d had.
            </p>
          </div>
          <div className="text-sm text-[var(--color-cream)]/60">
            <div className="mb-3 flex gap-5 sm:justify-end">
              <a href="/privacy" className="hover:text-[var(--color-cream)]">
                Privacy
              </a>
              <a href="/terms" className="hover:text-[var(--color-cream)]">
                SMS Terms
              </a>
              <a href="/login" className="hover:text-[var(--color-cream)]">
                Member sign-in
              </a>
            </div>
            <p>© {new Date().getFullYear()} Braintech · Mutant Ventures LLC</p>
            <p className="mt-1">Built for parents who&apos;d rather not fight.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
