import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Braintech vs Circle vs Bark — How they actually compare",
  description:
    "Same shelf as Circle and Bark. A different machine underneath. Inline gateway vs ARP-spoof boxes, earn-to-unlock screen time, and one subscription with the device included.",
};

const LEGEND = [
  { sym: "✓", color: "text-emerald-700", label: "Advantage" },
  { sym: "~", color: "text-amber-700", label: "Partial / depends" },
  { sym: "✕", color: "text-red-600", label: "Weakness or gap" },
  { sym: "★", color: "text-[var(--color-accent)]", label: "Only one ships this" },
  { sym: "—", color: "text-[var(--color-ink-soft)]", label: "Neutral / N/A" },
];

type Cell = {
  /** "yes" | "no" | "partial" | "only" | "none" | plain text */
  mark?: "yes" | "no" | "partial" | "only" | "none";
  text?: string;
};

type Row = {
  label: string;
  /** Optional sub-label rendered under the main label in muted text. */
  hint?: string;
  braintech: Cell;
  circle: Cell;
  bark: Cell;
};

type Section = {
  number: string;
  title: string;
  rows: Row[];
};

const SECTIONS: Section[] = [
  {
    number: "01",
    title: "Architecture & enforcement",
    rows: [
      {
        label: "How it controls the network",
        braintech: {
          mark: "yes",
          text:
            "True inline checkpoint. Traffic physically routes through the box; nothing reaches the internet around it.",
        },
        circle: {
          mark: "partial",
          text:
            "ARP spoofing — impersonates the gateway so traffic detours through it (a man-in-the-middle technique).",
        },
        bark: {
          mark: "partial",
          text: "ARP spoofing — same beside-the-router approach.",
        },
      },
      {
        label: "Can a kid escape it on the home network?",
        braintech: {
          mark: "yes",
          text:
            "No. MAC spoofing, static ARP, mesh quirks — none of it routes around an inline box.",
        },
        circle: {
          mark: "no",
          text:
            "Yes. Static ARP entries, MAC changes, and mesh/ISP gateways breaking the spoof are common escape routes.",
        },
        bark: { mark: "no", text: "Yes. Same evasion surface." },
      },
      {
        label: "Day-to-day reliability",
        braintech: {
          mark: "yes",
          text:
            "Set once, stays put. No re-pairing battle. If the box drops, the kids' segment loses internet — it fails closed, not open.",
        },
        circle: {
          mark: "partial",
          text:
            "Drop-outs reported; reviews cite devices disconnecting and needing the box restarted.",
        },
        bark: {
          mark: "partial",
          text: "Re-pairing complaints; devices “escaping” recur in reviews.",
        },
      },
      {
        label: "Install friction",
        braintech: {
          mark: "partial",
          text:
            "Plug inline — no network rebuild. No ISP credentials to re-enter. The one job: make sure the kids' devices actually sit behind the box.",
        },
        circle: {
          mark: "yes",
          text:
            "Easy first setup — plug into the router, change nothing (then fight the breakage later).",
        },
        bark: {
          mark: "yes",
          text: "Easy first setup — same low-friction start.",
        },
      },
    ],
  },
  {
    number: "02",
    title: "Where nobody gets to over-claim",
    rows: [
      {
        label: "Off the home Wi-Fi (cellular / LTE)",
        hint: "The classic teen move: turn Wi-Fi off",
        braintech: {
          mark: "partial",
          text:
            "Not covered by the box alone. A home gateway governs the home network; off-network needs a companion device app — same as everyone.",
        },
        circle: {
          mark: "partial",
          text: "Companion app / VPN extends to mobile via an on-device profile.",
        },
        bark: {
          mark: "partial",
          text: "Companion app — mobile coverage via the Bark for Kids app.",
        },
      },
      {
        label: "VPNs & encrypted DNS (DoH)",
        braintech: {
          mark: "yes",
          text:
            "Blocked harder, not magically. As the gateway, Braintech can force its own resolver and shut down DoH bypasses an ARP box can't reliably touch. Obfuscated VPNs still exist for everyone.",
        },
        circle: {
          mark: "no",
          text:
            "Weaker leverage — beside-router position limits how firmly bypasses can be forced.",
        },
        bark: { mark: "no", text: "Weaker leverage — same constraint." },
      },
      {
        label: "Content visibility inside HTTPS",
        braintech: {
          mark: "partial",
          text:
            "Domain-level, by design. Filters on destination, not message contents — no root cert on every device, no privacy minefield.",
        },
        circle: {
          mark: "partial",
          text: "Domain-level — same encrypted-traffic ceiling.",
        },
        bark: {
          mark: "yes",
          text:
            "Reads content on-device — Bark's real edge: its app scans texts/social for risk signals (a different job than the box).",
        },
      },
    ],
  },
  {
    number: "03",
    title: "Business model",
    rows: [
      {
        label: "What the parent actually buys",
        braintech: {
          mark: "yes",
          text:
            "One subscription. Device included. $0 hardware barrier, single line item. Cancel and the device goes back — nothing stranded.",
        },
        circle: {
          mark: "no",
          text:
            "Device up front + renewal: ~$129 box (first year bundled), then ~$99/yr to keep premium.",
        },
        bark: {
          mark: "no",
          text:
            "Device and a separate sub: $79 box, plus an active Bark subscription required on top — two purchases stacked.",
        },
      },
      {
        label: "Upfront cost to say yes",
        braintech: {
          mark: "yes",
          text: "$0 hardware — lowest barrier to activation in the category.",
        },
        circle: { mark: "no", text: "$129 — hardware paid before value." },
        bark: { mark: "no", text: "$79+ — hardware + sub before value." },
      },
    ],
  },
  {
    number: "04",
    title: "The thing only one of them does",
    rows: [
      {
        label: "The screen-time model",
        hint: "Block-and-restrict vs. earn-and-grow",
        braintech: {
          mark: "only",
          text:
            "Kids earn screen time by completing educational tasks. Time becomes something learned into, not just rationed. No competitor ships this loop.",
        },
        circle: {
          mark: "none",
          text:
            "Block & limit. Has a manual “reward minutes” toggle, but no earn-through-learning system.",
        },
        bark: {
          mark: "none",
          text:
            "Block & monitor. Center of gravity is alerts, not screen-time economics.",
        },
      },
    ],
  },
];

function MarkCell({ mark }: { mark?: Cell["mark"] }) {
  if (!mark) return null;
  const styles: Record<NonNullable<Cell["mark"]>, { sym: string; cls: string; label: string }> = {
    yes: { sym: "✓", cls: "bg-emerald-500/15 text-emerald-700", label: "Advantage" },
    no: { sym: "✕", cls: "bg-red-500/10 text-red-600", label: "Weakness" },
    partial: { sym: "~", cls: "bg-amber-500/15 text-amber-700", label: "Partial" },
    only: {
      sym: "★",
      cls: "bg-[var(--color-accent)]/15 text-[var(--color-accent)]",
      label: "Only one",
    },
    none: { sym: "—", cls: "bg-[var(--color-rule)]/40 text-[var(--color-ink-soft)]", label: "Neutral" },
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
    <section className="mt-12">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-xs uppercase tracking-wider text-[var(--color-accent)]">
          {section.number}
        </span>
        <h2 className="serif text-2xl leading-snug tracking-[-0.01em] sm:text-3xl">
          {section.title}
        </h2>
      </div>
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
      {/* Nav (matches /privacy + /terms chrome) */}
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
          Competitive Brief · Home Screen-Time Hardware
        </div>
        <h1 className="serif mt-4 max-w-3xl text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
          Same shelf as Circle and Bark.
          <br />
          <span className="text-[var(--color-accent)]">
            A different machine underneath.
          </span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--color-ink-soft)]">
          Circle and Bark sit <em>beside</em> your router and quietly impersonate
          the gateway to intercept traffic — a trick devices routinely slip past.
          Braintech sits <em>inline</em>: every packet behind the box has to
          pass through it, and kids earn their screen time by finishing real
          learning tasks.
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

        {/* Column legend (machine summary above the tables) */}
        <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-2xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-4">
            <div className="font-semibold text-[var(--color-ink)]">Braintech</div>
            <div className="mt-1 text-xs text-[var(--color-ink-soft)]">
              Inline gateway · double-NAT · subscription includes the device
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--color-rule)] bg-white p-4">
            <div className="font-semibold text-[var(--color-ink)]">
              Circle Home Plus
            </div>
            <div className="mt-1 text-xs text-[var(--color-ink-soft)]">
              ARP-based · device + renewing subscription
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--color-rule)] bg-white p-4">
            <div className="font-semibold text-[var(--color-ink)]">Bark Home</div>
            <div className="mt-1 text-xs text-[var(--color-ink-soft)]">
              ARP-based · device + separate Bark subscription required
            </div>
          </div>
        </div>
      </header>

      {/* Comparison sections */}
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
            Circle and Bark sit next to your router and impersonate it — kids&rsquo;
            devices slip past it all the time.{" "}
            <strong>Braintech is the checkpoint everything behind it has to cross.</strong>
            <br />
            <br />
            And it&rsquo;s the only one where kids <em>earn</em> their screen time
            by completing learning tasks — with the device included in the
            subscription, nothing to buy up front.
          </blockquote>

          <h3 className="serif mt-12 text-2xl leading-snug tracking-[-0.01em]">
            Three proof points, in priority order.
          </h3>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              {
                n: "01",
                title: "Earn-to-unlock",
                body:
                  "Kids earn screen time by completing educational tasks — the differentiator nobody else has.",
              },
              {
                n: "02",
                title: "Enforcement that doesn't break",
                body:
                  "Inline gateway vs ARP spoofing that devices escape. Set once, stays put.",
              },
              {
                n: "03",
                title: "Device included",
                body:
                  "One subscription. $0 up front vs paying for hardware and a sub stacked.",
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
            Pricing, illustrative.
          </h2>
        </div>
        <p className="mb-6 max-w-2xl text-sm text-[var(--color-ink-soft)]">
          List pricing as of mid-2026 — competitor promos vary. Verify before
          publishing.
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
              take: "One line item · $0 up front",
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

      {/* Honesty notes */}
      <section className="border-t border-[var(--color-rule)] bg-white">
        <div className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
          <div className="mb-3 flex items-baseline gap-3">
            <span className="font-mono text-xs uppercase tracking-wider text-[var(--color-accent)]">
              Caveats
            </span>
            <h2 className="serif text-2xl leading-snug tracking-[-0.01em] sm:text-3xl">
              Where we don&rsquo;t win yet.
            </h2>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)]/40 p-5">
              <div className="font-semibold text-[var(--color-ink)]">
                Cellular / off-network
              </div>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                The box governs the home network. A kid on LTE is outside it
                until there&rsquo;s a companion app — every competitor has the
                same gap.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)]/40 p-5">
              <div className="font-semibold text-[var(--color-ink)]">
                Double-NAT side effects
              </div>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                Console gaming (strict NAT), some video calls, and
                port-forwarding can degrade behind two NATs. We pair gaming
                households with a UPnP / known-good-config answer on setup.
              </p>
            </div>
          </div>

          <h3 className="serif mt-12 text-xl leading-snug tracking-[-0.01em]">
            Claim guardrails.
          </h3>
          <ul className="mt-4 space-y-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            <li>
              <strong className="text-[var(--color-ink)]">
                &ldquo;Inescapable behind the box&rdquo;
              </strong>{" "}
              = on-network traffic only. Never stated unqualified.
            </li>
            <li>
              <strong className="text-[var(--color-ink)]">
                &ldquo;Blocks VPNs / encrypted DNS&rdquo;
              </strong>{" "}
              is true for known / detectable bypasses — not &ldquo;VPNs
              can&rsquo;t get through.&rdquo; Obfuscated VPNs over 443 remain a
              category-wide limitation.
            </li>
            <li>
              Filtering is{" "}
              <strong className="text-[var(--color-ink)]">domain-level</strong>{" "}
              (destination / SNI), not content-level. Braintech does not read
              inside HTTPS — by design.
            </li>
          </ul>
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

      {/* Footer (matches /privacy + /terms) */}
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
