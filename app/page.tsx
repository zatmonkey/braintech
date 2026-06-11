import { cookies, headers } from "next/headers";
import { HeroWaitlist } from "./hero-waitlist";
import { ChatWidget } from "./chat-widget";
// Phase 4: counters / founding badge removed from hero; toasts kept for
// subtle social proof but rebranded ("just ordered" not "founding").
import { FoundingToasts } from "./founding-stats";
import { CurrencyPicker } from "./currency-picker";
import { VariationTracker } from "./variation-tracker";
import { CancelTracker } from "./cancel-tracker";
import { ExitIntent } from "./exit-intent";
import { DemoCTAClient } from "./demo-cta";
import { getVariation, type Variation } from "./variations";
import {
  pricingForCountry,
  type Pricing,
} from "./lib/pricing";
import { DISCOUNT_COUPON_ID } from "./lib/stripe";
import { BuyNowCard } from "./buy-now-card";
import {
  foundingScarcity,
  FOUNDING_BATCH_N,
  FOUNDING_BATCH_SHIPS,
} from "./lib/founding";

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

  // Show the discounted price + "10% off · locked in" in the buy-now card
  // if the visitor has already claimed the discount earlier on the page.
  const discountActive =
    cookieStore.get("bt_discount")?.value === DISCOUNT_COUPON_ID;

  return (
    <main className="flex flex-1 flex-col" data-variation={variation.id}>
      <Nav variation={variation} />
      <Hero variation={variation} pricing={pricing} />
      <Problem />
      <FounderSection />
      <HowItWorks />
      <ContentPartners />
      <Examples />
      {/* Testimonials section intentionally NOT rendered until we have
          real founding-family quotes to use. Fabricated/styled testimonials
          for this audience are both a conversion killer (sniff-test) and
          an FTC compliance risk under the 2024 Endorsement Guides. When
          real quotes exist, just put <Testimonials /> back in. */}
      <Pricing variation={variation} pricing={pricing} discountActive={discountActive} />
      <FAQ />
      <Footer country={pricing.country} />
      <ChatWidget />
      <FoundingToasts />
      <VariationTracker variationId={variation.id} />
      <CancelTracker />
      <ExitIntent />
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
      <div className="flex items-center gap-4 sm:gap-6">
        <a
          href="/compare"
          data-cta="nav-compare"
          className="hidden text-sm text-[var(--color-ink-soft)] transition hover:text-[var(--color-ink)] sm:inline"
        >
          vs Bark & Circle
        </a>
        <a
          href="#waitlist"
          data-cta="nav"
          data-variation={variation.id}
          className="rounded-full bg-[var(--color-ink)] px-4 py-1.5 text-sm font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)]"
        >
          Get 10% off
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
            {foundingScarcity()}
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
          <HeroWaitlist variation={variation} pricing={pricing} />
          <DemoCTA />
          <TrustStrip />
        </div>

        <HeroPhoto />
      </div>
    </section>
  );
}

function HeroPhoto() {
  return (
    <div
      className="relative mx-auto w-full max-w-md fade-up"
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
  );
}

function TrustStrip() {
  return (
    <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--color-ink-soft)]">
      <li className="inline-flex items-center gap-1.5">
        <Dot /> 30-day refund
      </li>
      <li className="inline-flex items-center gap-1.5">
        <Dot /> No app to install
      </li>
      <li className="inline-flex items-center gap-1.5">
        <Dot /> Cancel any time
      </li>
    </ul>
  );
}

function DemoCTA() {
  return <DemoCTAClient />;
}

function FounderSection() {
  return (
    <section className="border-y border-[var(--color-rule)] bg-white">
      <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-20 sm:px-10 sm:py-24 lg:grid-cols-[1fr_1.4fr] lg:gap-12">
        {/* Founder photo. Swap for a 60-90s founder reel if/when one's recorded. */}
        <div className="mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/founder-alex.jpg"
            alt="Alex, founder of Braintech, at his kitchen counter texting a rule into the device."
            width={400}
            height={400}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
            From the founder
          </div>
          <h2 className="serif mt-3 text-3xl leading-[1.1] tracking-[-0.02em] sm:text-4xl">
            I built Braintech because nothing else worked at my house.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-[var(--color-ink-soft)]">
            I&rsquo;m a parent and a tech person, in San Francisco. After
            losing three Sunday afternoons in a row to the same screen-time
            fight, I went looking for a fix and couldn&rsquo;t find one. Apps
            kids delete. Routers that only block. Subscriptions that punish
            instead of teach.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-[var(--color-ink-soft)]">
            So I built the thing I wanted: a little box on the home Wi-Fi that
            listens to a text. Network-level, because then it works on every
            screen and there&rsquo;s nothing on the kid&rsquo;s phone to delete.
            Earn-to-unlock, because saying no over and over is exhausting and
            saying &ldquo;yes, after this&rdquo; just&hellip; works.
          </p>
          <p className="mt-6 text-sm font-medium text-[var(--color-ink)]">
            — Alex, founder
          </p>
        </div>
      </div>
    </section>
  );
}

function Dot() {
  return (
    <span
      aria-hidden
      className="size-1.5 rounded-full bg-[var(--color-accent)]"
    />
  );
}

function Problem() {
  return (
    <section className="border-y border-[var(--color-rule)] bg-[var(--color-cream)]">
      <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-20 sm:px-10 sm:py-28 lg:grid-cols-[1fr_1fr]">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
            We get it
          </div>
          <h2 className="serif mt-3 text-4xl leading-[1.08] tracking-[-0.02em] sm:text-5xl">
            You&apos;re tired of being the screen-time police.
          </h2>
          <p className="mt-5 text-lg text-[var(--color-ink-soft)]">
            Every &ldquo;five more minutes&rdquo; turns into another argument.
            Every app you trusted last year is a different one now. Apps to
            block apps, dashboards that need babysitting, kids who already know
            three workarounds.
          </p>
          <p className="mt-4 text-lg text-[var(--color-ink-soft)]">
            You don&apos;t need another control panel. You need the fight to
            stop.
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--color-rule)] bg-white p-6 sm:p-8">
          <p className="serif text-2xl leading-snug text-[var(--color-ink)] sm:text-3xl">
            &ldquo;The bit that surprised me most: I stopped being the bad guy
            at bedtime. The device says no. I just say &lsquo;sure, what does
            Bri want?&rsquo;&rdquo;
          </p>
          <div className="mt-5 flex items-center gap-3 border-t border-[var(--color-rule)] pt-5 text-sm">
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
          </div>
        </div>
      </div>
    </section>
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

// Testimonials section removed 2026-06-09 until real founding-family
// quotes exist. Re-add with first_name + real detail when ready.
// Audience for this product sniffs out fabricated social proof, AND the
// FTC 2024 Endorsement Guides put per-violation penalties on fake
// reviews. "Founding families" / "early access" framing is the right
// label when we do have real ones — never use "beta" (poison in a
// product whose pitch is "it just works").

function Pricing({
  variation,
  pricing,
  discountActive,
}: {
  variation: Variation;
  pricing: Pricing;
  discountActive: boolean;
}) {
  return (
    <section
      id="waitlist"
      className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-10 sm:py-28"
    >
      <div className="grid items-start gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
            Buy now
          </div>
          <h2 className="serif mt-3 text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
            {pricing.purchaseLabel.replace("/yr", "")} for year one.
            <br />
            Device included.
          </h2>
          <p className="mt-5 text-lg text-[var(--color-ink-soft)]">
            Order today, plug it in when it arrives, and text Bri your house
            rules. Your subscription starts the day your device ships —
            30-day refund, cancel any time before renewal.
          </p>
          <p className="mt-4 text-sm font-medium text-[var(--color-accent)]">
            {foundingScarcity()}
          </p>
          <ul className="mt-8 space-y-3 text-[var(--color-ink)]">
            {[
              "The braintech device, shipped to you",
              "Unlimited rules across every screen in your home",
              "Up to 6 kids, named and personalised",
              "Direct line to the team during your first month",
              "30-day refund if it’s not for you",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3">
                <Check />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          {/* Honest price-anchoring against the two products our audience
              is already comparing us to. */}
          <p className="mt-7 rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)] p-5 text-sm leading-relaxed text-[var(--color-ink)]">
            <strong>Bark Home blocks.</strong>{" "}
            <strong>Circle limits.</strong> Braintech is the only one that
            turns screen time into learning — and the only one with{" "}
            <strong>nothing on their phone to delete</strong>.
          </p>
        </div>
        <div>
          <BuyNowCard
            variation={variation.id}
            pricing={pricing}
            discountActive={discountActive}
          />
        </div>
      </div>
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
      q: "What exactly happens when I order?",
      a: `Three things. (1) You pay $249 for year one — or $224 if you grabbed the 10% off code from your inbox. (2) Your device ships in founding batch #${FOUNDING_BATCH_N}, in ${FOUNDING_BATCH_SHIPS}. (3) Your annual subscription starts the day your device is in your hands — not before. Full refund any time before it ships, and 30 days after.`,
    },
    {
      q: "What do you do with my family's data?",
      a: "We process your rules so Braintech can enforce them — nothing else. We don't sell browsing data. We don't run ads. Your kids' data is never used for marketing. Read the full privacy policy →",
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

function Footer({ country }: { country: string }) {
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
              <a href="/compare" className="hover:text-[var(--color-cream)]">
                Compare
              </a>
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
            <div className="mb-3 flex sm:justify-end">
              <CurrencyPicker currentCountry={country} />
            </div>
            <p>© {new Date().getFullYear()} Braintech · Mutant Ventures LLC</p>
            <p className="mt-1">Built for parents who&apos;d rather not fight.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
