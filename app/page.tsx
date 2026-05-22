import { WaitlistForm } from "./waitlist-form";
import { getVariation, type Variation } from "./variations";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const variation = getVariation(params.variation);
  return (
    <main className="flex flex-1 flex-col" data-variation={variation.id}>
      <Nav variation={variation} />
      <Hero variation={variation} />
      <Problem />
      <HowItWorks />
      <ContentPartners />
      <Examples />
      <Pricing variation={variation} />
      <FAQ />
      <Footer />
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
      <a
        href="#waitlist"
        data-cta="nav"
        data-variation={variation.id}
        className="rounded-full border border-[var(--color-ink)] px-4 py-1.5 text-sm font-medium text-[var(--color-ink)] transition hover:bg-[var(--color-ink)] hover:text-[var(--color-cream)]"
      >
        Join waitlist
      </a>
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

function Hero({ variation }: { variation: Variation }) {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-6 pb-16 pt-8 sm:px-10 sm:pb-24 sm:pt-12">
      <div className="grid items-start gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div className="fade-up">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-rule)] bg-white/60 px-3 py-1 text-xs font-medium text-[var(--color-ink-soft)]">
            <span className="size-1.5 rounded-full bg-[var(--color-accent)] pulse-dot" />
            {variation.eyebrow}
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
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href="#waitlist"
              data-cta="hero-primary"
              data-variation={variation.id}
              className="inline-flex items-center justify-center rounded-lg bg-[var(--color-ink)] px-6 py-3.5 text-base font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)]"
            >
              {variation.cta}
            </a>
            <a
              href="#how-it-works"
              data-cta="hero-secondary"
              data-variation={variation.id}
              className="inline-flex items-center justify-center rounded-lg border border-[var(--color-rule)] px-6 py-3.5 text-base font-medium text-[var(--color-ink)] transition hover:border-[var(--color-ink)]"
            >
              See how it works
            </a>
          </div>
          <p className="mt-5 text-sm text-[var(--color-ink-soft)]">
            Founding price <strong>$249/year</strong> — locked in for life.
            Ships when your batch is ready.
          </p>
        </div>

        <HeroPhone />
      </div>
    </section>
  );
}

function HeroPhone() {
  return (
    <div
      className="relative mx-auto w-full max-w-md fade-up"
      style={{ animationDelay: "120ms" }}
    >
      <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-br from-[var(--color-accent)]/15 via-transparent to-[var(--color-ink)]/5 blur-2xl" />
      <div className="rounded-[2.5rem] border border-[var(--color-rule)] bg-[var(--color-night)] p-3 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.35)]">
        <div className="rounded-[2rem] bg-[#1c1c1f] p-5">
          <div className="flex items-center justify-between text-[10px] font-medium text-white/60">
            <span>9:41</span>
            <span>braintech</span>
            <span>•••</span>
          </div>
          <div className="mt-4 space-y-2.5">
            <Bubble side="out">
              No iPad for Maya until she watches a TED talk and answers 3
              questions about it.
            </Bubble>
            <Bubble side="in" muted>
              Got it. Maya&apos;s iPad is paused. I&apos;ll DM her a 12-min talk
              on octopus intelligence + a quiz. Unlocks on 3/3 correct.
            </Bubble>
            <Bubble side="in" muted delay={400}>
              <span className="text-emerald-300">●</span> 14 min later — Maya
              scored 3/3. iPad unlocked for 45 min.
            </Bubble>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  side,
  children,
  muted,
  delay = 0,
}: {
  side: "in" | "out";
  children: React.ReactNode;
  muted?: boolean;
  delay?: number;
}) {
  const isOut = side === "out";
  return (
    <div
      className={`flex ${isOut ? "justify-end" : "justify-start"} fade-up`}
      style={{ animationDelay: `${delay + 200}ms` }}
    >
      <div
        className={[
          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-snug",
          isOut
            ? "rounded-br-md bg-[#2b8aff] text-white"
            : muted
              ? "rounded-bl-md bg-white/8 text-white/90"
              : "rounded-bl-md bg-white/12 text-white",
        ].join(" ")}
      >
        {children}
      </div>
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
        <div className="relative flex items-center justify-center overflow-hidden rounded-3xl border border-[var(--color-rule)] bg-gradient-to-b from-[#17171c] to-[var(--color-night)] p-8 sm:p-12">
          {/* pulsing glow behind the device — the brain "at work" */}
          <div className="brain-glow pointer-events-none absolute left-1/2 top-1/2 size-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,241,234,0.55),transparent_65%)]" />
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

function Pricing({ variation }: { variation: Variation }) {
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
            $249/year. Locked in for life.
          </h2>
          <p className="mt-5 text-lg text-[var(--color-ink-soft)]">
            We&apos;re building the first 1,000 devices in a single batch.
            Founding members get the device, the membership, and the price they
            join at — forever.
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
          <p className="mt-8 text-sm text-[var(--color-ink-soft)]">
            After the first 1,000, pricing goes to $349/year.
          </p>
        </div>
        <div>
          <WaitlistForm variationId={variation.id} />
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
            </div>
            <p>© {new Date().getFullYear()} Braintech · Mutant Ventures LLC</p>
            <p className="mt-1">Built for parents who&apos;d rather not fight.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
