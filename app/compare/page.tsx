import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Braintech vs Circle vs Bark — In plain English",
  description:
    "A friendly side-by-side of the three home boxes for screen-time control. How they work, what they cost, and the one thing only Braintech does.",
};

const LEGEND = [
  { sym: "✓", color: "text-emerald-700", label: "Yes" },
  { sym: "~", color: "text-amber-700", label: "Sort of" },
  { sym: "✕", color: "text-red-600", label: "No" },
  { sym: "★", color: "text-[var(--color-accent)]", label: "Only one does this" },
];

type Cell = {
  mark: "yes" | "no" | "partial" | "only" | "none";
  text?: string;
};

type Row = {
  label: string;
  hint?: string;
  braintech: Cell;
  circle: Cell;
  bark: Cell;
};

type Section = {
  number: string;
  title: string;
  body: string;
  rows: Row[];
};

const SECTIONS: Section[] = [
  {
    number: "01",
    title: "How it actually controls your network",
    body:
      "The cheapest way to filter traffic is to sit beside your router and pretend to be it. Modern phones, game consoles, and mesh systems often see through the trick and route around it. Braintech replaces your router as the gateway — there's nothing to see through.",
    rows: [
      {
        label: "Every packet has to pass through it",
        braintech: { mark: "yes", text: "Yes — it is the gateway." },
        circle: {
          mark: "no",
          text: "No — sits beside the router and intercepts.",
        },
        bark: {
          mark: "no",
          text: "No — same beside-the-router approach.",
        },
      },
      {
        label: "A kid can't route around it at home",
        braintech: {
          mark: "yes",
          text: "Inline. No bypass works — there's no “gateway” to fake.",
        },
        circle: {
          mark: "no",
          text:
            "Static-ARP tricks, MAC changes, and some mesh setups escape it.",
        },
        bark: { mark: "no", text: "Same evasion surface." },
      },
      {
        label: "Set once, stays put",
        braintech: {
          mark: "yes",
          text: "Reviews don't fight re-pairing battles. Fails closed.",
        },
        circle: {
          mark: "partial",
          text: "Drop-outs in reviews — needs restarts.",
        },
        bark: { mark: "partial", text: "“Escaping” devices recur in reviews." },
      },
      {
        label: "Plug it in, you're done",
        hint: "All three are plug-in boxes; details below.",
        braintech: {
          mark: "yes",
          text:
            "Plug-and-play. Your existing Wi-Fi switches to access-point mode — Bri walks you through it in about a minute.",
        },
        circle: {
          mark: "yes",
          text: "Plug beside the router, change nothing.",
        },
        bark: {
          mark: "yes",
          text: "Plug beside the router, change nothing.",
        },
      },
    ],
  },
  {
    number: "02",
    title: "Privacy & bypass resistance",
    body:
      "You want strong control without spying on your kid's messages or installing a certificate that reads everything they type. All three boxes filter by destination (the domain the device is reaching) — none of them read the words inside encrypted traffic. Where Braintech goes further is on the bypass tools kids actually try.",
    rows: [
      {
        label: "Forces all DNS through one resolver",
        hint: "Closes the “just set 8.8.8.8 yourself” bypass.",
        braintech: {
          mark: "yes",
          text: "Yes — as the gateway, it's enforced cleanly.",
        },
        circle: {
          mark: "partial",
          text: "Limited — relies on the beside-router trick holding.",
        },
        bark: { mark: "partial", text: "Same limit." },
      },
      {
        label: "Blocks encrypted-DNS bypasses (DoH / DoT)",
        braintech: {
          mark: "yes",
          text:
            "Domain block + IP block on known DoH endpoints. Updated regularly.",
        },
        circle: {
          mark: "partial",
          text: "Patchier — Chrome's secure DNS often slips by.",
        },
        bark: { mark: "partial", text: "Same patchiness." },
      },
      {
        label: "Doesn't read inside your kid's messages",
        hint: "No root certificate installed on the kid's phone.",
        braintech: { mark: "yes", text: "Filters destinations only." },
        circle: { mark: "yes", text: "Filters destinations only." },
        bark: {
          mark: "yes",
          text:
            "Box doesn't. (The separate Bark phone app does — that's a different product.)",
        },
      },
    ],
  },
  {
    number: "03",
    title: "What you actually pay for",
    body:
      "Some boxes sell you hardware first, then a subscription on top. Braintech is one line item: the device is included. If you cancel, the device goes back — nothing stranded on a shelf.",
    rows: [
      {
        label: "Device included in the subscription",
        braintech: { mark: "yes", text: "Yes — $0 hardware barrier." },
        circle: {
          mark: "no",
          text: "$129 box up front (first-year sub bundled).",
        },
        bark: {
          mark: "no",
          text: "$79 box + ~$99/yr Bark sub required on top.",
        },
      },
      {
        label: "Upfront cost to say yes today",
        braintech: { mark: "yes", text: "$0" },
        circle: { mark: "no", text: "~$129" },
        bark: { mark: "no", text: "~$79 + sub" },
      },
    ],
  },
  {
    number: "04",
    title: "The thing only one of us does",
    body:
      "Every parental-control product on the shelf is some flavour of block-and-limit. Braintech is the only one where your kid earns screen time by finishing a learning task — a TED talk, a Khan Academy lesson, twenty minutes of reading. Time stops being a battle you ration and starts being something they grow into.",
    rows: [
      {
        label: "Kids EARN screen time by completing learning tasks",
        braintech: {
          mark: "only",
          text:
            "Yes. The differentiator nobody else ships — block, plus a way out through learning.",
        },
        circle: {
          mark: "none",
          text: "Block & limit. A “bonus minutes” toggle exists, but no learning loop.",
        },
        bark: {
          mark: "none",
          text:
            "Block & alert. Center of gravity is monitoring, not screen-time economics.",
        },
      },
    ],
  },
];

function MarkCell({ mark }: { mark: Cell["mark"] }) {
  const styles: Record<Cell["mark"], { sym: string; cls: string; label: string }> = {
    yes: { sym: "✓", cls: "bg-emerald-500/15 text-emerald-700", label: "Yes" },
    no: { sym: "✕", cls: "bg-red-500/10 text-red-600", label: "No" },
    partial: { sym: "~", cls: "bg-amber-500/15 text-amber-700", label: "Sort of" },
    only: {
      sym: "★",
      cls: "bg-[var(--color-accent)]/15 text-[var(--color-accent)]",
      label: "Only one",
    },
    none: {
      sym: "—",
      cls: "bg-[var(--color-rule)]/40 text-[var(--color-ink-soft)]",
      label: "Neutral",
    },
  };
  const s = styles[mark];
  return (
    <span
      className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${s.cls}`}
      aria-label={s.label}
      title={s.label}
    >
      {s.sym}
    </span>
  );
}

function ComparisonRow({
  row,
  highlight = false,
}: {
  row: Row;
  highlight?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-4 border-t border-[var(--color-rule)] px-5 py-5 sm:grid-cols-[1.2fr_1fr_1fr_1fr] sm:gap-6 sm:px-6 ${
        highlight ? "bg-[var(--color-accent)]/5" : ""
      }`}
    >
      <div>
        <div className="font-semibold leading-snug text-[var(--color-ink)]">
          {row.label}
        </div>
        {row.hint && (
          <div className="mt-1 text-xs text-[var(--color-ink-soft)]">
            {row.hint}
          </div>
        )}
      </div>
      {(["braintech", "circle", "bark"] as const).map((col) => {
        const cell = row[col];
        return (
          <div key={col} className="flex items-start gap-2.5">
            <MarkCell mark={cell.mark} />
            <p className="text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {cell.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function SectionBlock({ section }: { section: Section }) {
  return (
    <section className="mt-14">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-xs uppercase tracking-wider text-[var(--color-accent)]">
          {section.number}
        </span>
        <h2 className="serif text-2xl leading-snug tracking-[-0.01em] sm:text-3xl">
          {section.title}
        </h2>
      </div>
      <p className="mb-5 max-w-3xl leading-relaxed text-[var(--color-ink-soft)]">
        {section.body}
      </p>
      <div className="overflow-hidden rounded-2xl border border-[var(--color-rule)] bg-white">
        <div className="hidden border-b border-[var(--color-rule)] bg-[var(--color-cream)]/60 px-6 py-3 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)] sm:grid sm:grid-cols-[1.2fr_1fr_1fr_1fr] sm:gap-6">
          <span>&nbsp;</span>
          <span className="text-[var(--color-ink)]">Braintech</span>
          <span>Circle Home Plus</span>
          <span>Bark Home</span>
        </div>
        {section.rows.map((row, i) => (
          <ComparisonRow
            key={i}
            row={row}
            highlight={section.number === "04" && i === 0}
          />
        ))}
      </div>
    </section>
  );
}

export default function ComparePage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Nav */}
      <nav className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Braintech"
            width={28}
            height={28}
            className="size-7 rounded-md"
          />
          <span className="font-semibold tracking-tight">braintech</span>
        </Link>
        <Link
          href="/#waitlist"
          className="rounded-full bg-[var(--color-ink)] px-4 py-1.5 text-sm font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)]"
        >
          Get 10% off
        </Link>
      </nav>

      {/* Hero */}
      <header className="mx-auto w-full max-w-5xl px-6 pb-6 pt-6 sm:pt-10">
        <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
          How Braintech compares
        </div>
        <h1 className="serif mt-4 max-w-3xl text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
          Same shelf as Bark and Circle.
          <br />
          <span className="text-[var(--color-accent)]">
            A different machine underneath.
          </span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--color-ink-soft)]">
          Bark and Circle sit beside your router and try to look like it.
          Modern phones often see through the trick. Braintech replaces your
          router as the gateway — so there&rsquo;s nothing to see through.
          Here&rsquo;s what changes, in plain English.
        </p>

        {/* Legend */}
        <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 rounded-2xl border border-[var(--color-rule)] bg-white px-5 py-3 text-xs">
          <span className="text-[var(--color-ink-soft)]">Legend</span>
          {LEGEND.map((l) => (
            <span key={l.sym} className="inline-flex items-center gap-1.5">
              <span className={`font-mono font-semibold ${l.color}`}>{l.sym}</span>
              <span className="text-[var(--color-ink-soft)]">{l.label}</span>
            </span>
          ))}
        </div>

        {/* Machine summary in friendly language */}
        <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-2xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-4">
            <div className="font-semibold text-[var(--color-ink)]">Braintech</div>
            <div className="mt-1 text-xs text-[var(--color-ink-soft)]">
              Replaces your router as the gateway. Everything flows through it.
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--color-rule)] bg-white p-4">
            <div className="font-semibold text-[var(--color-ink)]">
              Circle Home Plus
            </div>
            <div className="mt-1 text-xs text-[var(--color-ink-soft)]">
              Sits beside your router and pretends to be it.
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--color-rule)] bg-white p-4">
            <div className="font-semibold text-[var(--color-ink)]">Bark Home</div>
            <div className="mt-1 text-xs text-[var(--color-ink-soft)]">
              Same beside-the-router trick. Bark&rsquo;s phone app adds content
              scanning (a different product).
            </div>
          </div>
        </div>
      </header>

      {/* Sections */}
      <div className="mx-auto w-full max-w-5xl px-6 pb-8">
        {SECTIONS.map((s) => (
          <SectionBlock key={s.number} section={s} />
        ))}
      </div>

      {/* Positioning copy */}
      <section className="border-y border-[var(--color-rule)] bg-[var(--color-cream)]">
        <div className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
          <h2 className="serif text-3xl leading-snug tracking-[-0.01em] sm:text-4xl">
            The two-sentence pitch.
          </h2>
          <blockquote className="mt-6 max-w-3xl border-l-2 border-[var(--color-accent)] pl-5 text-lg leading-relaxed text-[var(--color-ink)]">
            Bark and Circle sit next to your router and try to look like it
            — kids&rsquo; devices slip past them all the time.{" "}
            <strong>
              Braintech is the gateway. Everything behind it has to pass through.
            </strong>
            <br />
            <br />
            And it&rsquo;s the only one where your kid <em>earns</em> their
            screen time by completing a learning task — with the device
            included in the subscription, nothing to buy up front.
          </blockquote>

          <h3 className="serif mt-12 text-2xl leading-snug tracking-[-0.01em]">
            Three reasons families pick us.
          </h3>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              {
                n: "01",
                title: "Earn-to-unlock",
                body:
                  "Kids earn screen time by completing learning tasks — the one feature nobody else has.",
              },
              {
                n: "02",
                title: "Enforcement that doesn't break",
                body:
                  "Inline gateway vs. beside-the-router tricks. Set once, stays put.",
              },
              {
                n: "03",
                title: "Device included",
                body:
                  "One subscription, the box is in it. $0 today vs. paying for hardware AND a sub.",
              },
            ].map((p) => (
              <li
                key={p.n}
                className="rounded-2xl border border-[var(--color-rule)] bg-white p-5"
              >
                <div className="font-mono text-xs uppercase tracking-wider text-[var(--color-accent)]">
                  {p.n}
                </div>
                <div className="mt-2 font-semibold text-[var(--color-ink)]">
                  {p.title}
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                  {p.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Pricing */}
      <section className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="font-mono text-xs uppercase tracking-wider text-[var(--color-accent)]">
            Year one
          </span>
          <h2 className="serif text-2xl leading-snug tracking-[-0.01em] sm:text-3xl">
            What you&rsquo;ll actually spend.
          </h2>
        </div>
        <p className="mb-6 max-w-2xl text-sm text-[var(--color-ink-soft)]">
          Competitor list pricing as of 2026. Promos vary — check before
          buying.
        </p>
        <div className="overflow-hidden rounded-2xl border border-[var(--color-rule)] bg-white">
          <div className="grid grid-cols-1 gap-4 border-b border-[var(--color-rule)] bg-[var(--color-cream)]/60 px-5 py-3 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)] sm:grid-cols-4 sm:gap-6 sm:px-6">
            <span>Product</span>
            <span>Device</span>
            <span>Subscription</span>
            <span>Year-one takeaway</span>
          </div>
          {[
            {
              product: "Braintech",
              device: "included",
              sub: "all-in",
              take: "$0 today · one line item",
              highlight: true,
            },
            {
              product: "Circle Home Plus",
              device: "~$129 (yr-1 sub bundled)",
              sub: "~$99/yr after",
              take: "Hardware paid before value",
            },
            {
              product: "Bark Home",
              device: "$79 one-time",
              sub: "$99/yr (required)",
              take: "~$178 yr-1 · two purchases",
            },
          ].map((row) => (
            <div
              key={row.product}
              className={`grid grid-cols-1 gap-4 border-t border-[var(--color-rule)] px-5 py-4 text-sm sm:grid-cols-4 sm:gap-6 sm:px-6 ${
                row.highlight ? "bg-[var(--color-accent)]/5" : ""
              }`}
            >
              <span className="font-semibold text-[var(--color-ink)]">
                {row.product}
              </span>
              <span className="text-[var(--color-ink-soft)]">{row.device}</span>
              <span className="text-[var(--color-ink-soft)]">{row.sub}</span>
              <span className="text-[var(--color-ink-soft)]">{row.take}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Honest caveats — kept short, friendly */}
      <section className="border-t border-[var(--color-rule)] bg-white">
        <div className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
          <div className="mb-3 flex items-baseline gap-3">
            <span className="font-mono text-xs uppercase tracking-wider text-[var(--color-accent)]">
              Things to know
            </span>
            <h2 className="serif text-2xl leading-snug tracking-[-0.01em] sm:text-3xl">
              The honest small print.
            </h2>
          </div>
          <p className="max-w-3xl text-[var(--color-ink-soft)]">
            Two things every home parental-control box has in common — worth
            knowing whichever one you pick.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)]/40 p-5">
              <div className="font-semibold text-[var(--color-ink)]">
                Off the home Wi-Fi
              </div>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                Any home box can only protect what&rsquo;s on the home
                network. When a kid&rsquo;s phone is on cellular at school,
                that&rsquo;s the phone&rsquo;s screen-time controls&rsquo; job
                (Apple Screen Time, Google Family Link). Every box on this
                page has the same limit — we&rsquo;ll be honest about it.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)]/40 p-5">
              <div className="font-semibold text-[var(--color-ink)]">
                Setup note: access-point mode
              </div>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                Because Braintech is the gateway (that&rsquo;s why it works
                so well), your existing Wi-Fi router needs to switch to
                access-point mode for the first 60 seconds of setup. Bri
                walks you through it for your specific router — it&rsquo;s
                one menu toggle, then plug-and-play.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--color-rule)] bg-[var(--color-cream)]">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-start gap-4 px-6 py-12 sm:flex-row sm:items-center sm:justify-between sm:py-16">
          <div>
            <h2 className="serif text-2xl leading-snug tracking-[-0.01em] sm:text-3xl">
              Different machine. Different outcome.
            </h2>
            <p className="mt-2 max-w-xl text-sm text-[var(--color-ink-soft)]">
              Drop your email, save 10%, and your founding spot is held.
            </p>
          </div>
          <Link
            href="/#waitlist"
            className="rounded-full bg-[var(--color-ink)] px-5 py-3 font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)]"
          >
            Get 10% off →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-[var(--color-rule)] bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-[var(--color-ink-soft)]">
          <span>© {new Date().getFullYear()} Braintech · Mutant Ventures LLC</span>
          <div className="flex gap-5">
            <Link href="/" className="hover:text-[var(--color-ink)]">
              Home
            </Link>
            <Link href="/compare" className="hover:text-[var(--color-ink)]">
              Compare
            </Link>
            <Link href="/privacy" className="hover:text-[var(--color-ink)]">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-[var(--color-ink)]">
              SMS Terms
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
