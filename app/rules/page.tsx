import type { Metadata } from "next";
import { getSql, ensureContentSchema } from "@/app/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 3600; // ISR — 1h freshness, public page

export const metadata: Metadata = {
  title: "Rules That Work · Braintech",
  description:
    "A library of real text rules parents are using to end the screen-time fight. Updated weekly.",
  openGraph: {
    title: "Rules That Work · Braintech",
    description:
      "Real text rules parents are using to end the screen-time fight.",
  },
};

type RuleRow = {
  scheduled_for: string;
  caption: string | null;
  permalink: string | null;
  posted_at: string | null;
};

// Extract the rule and the body from the calendar caption. Tuesday
// rule-of-the-week captions follow a consistent shape:
//   🟠 Rule of the Week #N:
//
//   "<the actual rule, in quotes>"
//
//   <reasoning paragraphs>
function parseRule(caption: string | null): {
  rule: string | null;
  body: string;
} {
  if (!caption) return { rule: null, body: "" };
  // Find the first quoted string anywhere in the caption (regular OR curly
  // quotes). The Tuesday caption shape is:
  //   🟠 Rule of the Week #N:
  //
  //   "<the rule>"
  //
  //   <body paragraphs>
  const m = caption.match(/[""]([^""]{8,})[""]/) ?? caption.match(/"([^"]{8,})"/);
  const rule = m ? m[1].trim() : null;
  // Body = everything after the rule line. Find the line with the rule and
  // start from the next double-newline.
  let body = caption;
  if (rule) {
    const idx = caption.indexOf(rule);
    const afterRule = caption.slice(idx + rule.length);
    const para = afterRule.indexOf("\n\n");
    body = para > -1 ? afterRule.slice(para + 2).trim() : afterRule.trim();
  }
  return { rule, body };
}

export default async function RulesLibrary() {
  const sql = getSql();
  let rows: RuleRow[] = [];
  if (sql) {
    await ensureContentSchema(sql);
    rows = (await sql`
      SELECT scheduled_for::text AS scheduled_for, caption, permalink, posted_at
      FROM content_calendar
      WHERE theme = 'rule_of_the_week'
        AND caption IS NOT NULL
      ORDER BY scheduled_for ASC;
    `) as RuleRow[];
  }

  const rules = rows
    .map((r, i) => ({ ...parseRule(r.caption), index: i + 1, row: r }))
    .filter((r) => r.rule);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12 sm:py-20">
      <nav className="mb-8 text-xs uppercase tracking-wider text-[var(--color-ink-soft)]">
        <a href="/" className="hover:text-[var(--color-ink)]">
          ← braintech
        </a>
      </nav>
      <header>
        <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
          The library
        </div>
        <h1 className="serif mt-3 text-4xl leading-tight tracking-tight sm:text-6xl">
          Rules that work.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--color-ink-soft)]">
          A growing collection of real text rules parents are using to end the
          screen-time fight. New one every Tuesday. Each one is a single text —
          a Braintech device on your home Wi-Fi makes it the law of the house.
        </p>
      </header>

      {rules.length === 0 ? (
        <p className="mt-12 rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)] p-6 text-[var(--color-ink-soft)]">
          The first rules are publishing soon — check back Tuesday.
        </p>
      ) : (
        <section className="mt-12 space-y-8">
          {rules.map((r) => (
            <RuleCard
              key={r.row.scheduled_for}
              n={r.index}
              rule={r.rule!}
              body={r.body}
              date={r.row.scheduled_for}
              permalink={r.row.permalink}
              posted={!!r.row.posted_at}
            />
          ))}
        </section>
      )}

      <section className="mt-20 rounded-3xl border border-[var(--color-rule)] bg-[var(--color-night)] p-8 text-[var(--color-cream)] sm:p-12">
        <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent-soft)]">
          Want this for your house?
        </div>
        <h2 className="serif mt-3 text-3xl leading-snug sm:text-4xl">
          Drop your email — save 10% on your first year.
        </h2>
        <p className="mt-4 max-w-xl text-white/70">
          One device. One text. Every screen in the house listens. Subscription
          starts the day your device ships. 30-day refund.
        </p>
        <a
          href="/start"
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-[var(--color-accent)] px-6 py-3 font-medium text-white transition hover:brightness-95"
        >
          See how it works →
        </a>
      </section>
    </main>
  );
}

function RuleCard({
  n,
  rule,
  body,
  date,
  permalink,
  posted,
}: {
  n: number;
  rule: string;
  body: string;
  date: string;
  permalink: string | null;
  posted: boolean;
}) {
  const dateObj = new Date(date + "T12:00:00");
  const nice = dateObj.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return (
    <article className="rounded-2xl border border-[var(--color-rule)] bg-white p-6 sm:p-8">
      <div className="flex flex-wrap items-baseline gap-3 text-xs text-[var(--color-ink-soft)]">
        <span className="font-mono uppercase tracking-wider">
          #{String(n).padStart(2, "0")}
        </span>
        <span>·</span>
        <span>{nice}</span>
        {posted && permalink && (
          <>
            <span>·</span>
            <a
              href={permalink}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-accent)] hover:underline"
            >
              See on Instagram →
            </a>
          </>
        )}
      </div>
      <blockquote className="serif mt-4 text-2xl leading-snug text-[var(--color-ink)] sm:text-3xl">
        &ldquo;{rule}&rdquo;
      </blockquote>
      {body && (
        <p className="mt-5 whitespace-pre-line text-base leading-relaxed text-[var(--color-ink-soft)]">
          {body
            // Strip the trailing comment-prompt + hashtags so the body reads
            // as a self-contained essay on the public page.
            .split(/\n\nWhat['']?s|\n\nComment|\n\n#/)[0]
            .trim()}
        </p>
      )}
    </article>
  );
}
