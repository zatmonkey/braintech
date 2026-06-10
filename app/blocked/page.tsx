import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Paused by Braintech",
  description:
    "This page or app is paused right now. A grown-up at home set screen-time rules — check with them about earning time back.",
  robots: { index: false, follow: false },
};

/**
 * Landing page kids end up on when they hit a blocked site and the router's
 * captive-redirect catches their plain-HTTP request. Also reachable
 * directly so parents can point kids at it. Friendly first, informational
 * second.
 *
 * Designed for: a kid (8–14) and a parent looking over their shoulder. No
 * shaming, no fear, no apps-to-install pitches. Just "this is paused, here
 * is what's actually happening, here is how time comes back."
 */
export default async function BlockedPage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise that must be awaited.
  searchParams?: Promise<{ app?: string; host?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const app = sp.app?.slice(0, 32);
  const host = sp.host?.slice(0, 64);

  return (
    <main className="flex min-h-screen flex-col">
      {/* Minimal nav — no "Get 10% off" here. This is a service page,
          not a marketing page. */}
      <nav className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6">
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
      </nav>

      <section className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 sm:py-16">
        {/* Eyebrow + headline */}
        <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
          Paused by Braintech
        </div>
        <h1 className="serif mt-4 text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
          This is paused right now.
        </h1>

        {/* Friendly body addressed to the kid */}
        <div className="mt-7 space-y-4 text-lg leading-relaxed text-[var(--color-ink-soft)]">
          {app || host ? (
            <p>
              The thing you tried to open
              {app ? (
                <>
                  {" "}
                  — <strong className="text-[var(--color-ink)]">{app}</strong>
                </>
              ) : null}
              {host ? (
                <>
                  {" "}
                  (<span className="font-mono text-sm">{host}</span>)
                </>
              ) : null}{" "}
              is on the paused list right now.
            </p>
          ) : (
            <p>
              The thing you tried to open is on the paused list right now.
            </p>
          )}
          <p>
            A grown-up at your house set up screen-time rules. This
            isn&rsquo;t a punishment and it isn&rsquo;t a glitch — the
            Braintech box that runs your home Wi-Fi is doing what they
            asked it to.
          </p>
          <p>
            <strong className="text-[var(--color-ink)]">
              Time comes back when you earn it.
            </strong>{" "}
            Most families set up a learning trade: a TED talk, a Khan
            Academy lesson, twenty minutes of reading. Ask the grown-up at
            home what unlocks it.
          </p>
        </div>

        {/* What's NOT happening — privacy reassurance, parent-targeted */}
        <div className="mt-10 rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)]/50 p-5 sm:p-6">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-accent)]">
            What&rsquo;s NOT happening
          </div>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            <li className="flex gap-3">
              <Dot />
              Braintech is <strong className="text-[var(--color-ink)]">
                not reading your messages
              </strong>
              , your texts, or anything inside an app.
            </li>
            <li className="flex gap-3">
              <Dot />
              Nothing got installed on this device. There&rsquo;s no app
              spying on you.
            </li>
            <li className="flex gap-3">
              <Dot />
              We just told the home Wi-Fi: &ldquo;don&rsquo;t carry traffic
              to this site for these devices right now.&rdquo; The internet
              for everything else is exactly the same.
            </li>
          </ul>
        </div>

        {/* Two paths forward */}
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--color-rule)] bg-white p-5">
            <div className="font-semibold text-[var(--color-ink)]">
              If you&rsquo;re the kid
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              Find your parent or the grown-up who runs the Wi-Fi at home.
              They can change the rule, unlock you for a bit, or tell you
              what to do to earn the time back. Either way: talking to them
              is the unlock.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--color-rule)] bg-white p-5">
            <div className="font-semibold text-[var(--color-ink)]">
              If you&rsquo;re the parent
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              Sign in to your Braintech dashboard at{" "}
              <Link
                href="/app"
                className="font-medium text-[var(--color-accent)] hover:underline"
              >
                getbraintech.com/app
              </Link>{" "}
              to adjust the rule, pause it for an hour, or remove it. You
              can also text Bri in the dashboard — &ldquo;unlock YouTube
              for Alex until 9pm&rdquo; works.
            </p>
          </div>
        </div>

        {/* Footer note */}
        <p className="mt-12 text-xs text-[var(--color-ink-soft)]">
          Reached this page by accident? You might be a parent testing the
          block, or a kid whose grown-up set up Braintech recently. Either
          way — head to{" "}
          <Link href="/" className="underline hover:text-[var(--color-ink)]">
            getbraintech.com
          </Link>{" "}
          for context, or{" "}
          <Link
            href="/app"
            className="underline hover:text-[var(--color-ink)]"
          >
            /app
          </Link>{" "}
          to manage rules.
        </p>
      </section>

      {/* Subtle bottom — not the marketing footer; this page isn't trying to sell. */}
      <footer className="border-t border-[var(--color-rule)] bg-white">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-xs text-[var(--color-ink-soft)]">
          <span>© {new Date().getFullYear()} Braintech</span>
          <div className="flex gap-5">
            <Link href="/" className="hover:text-[var(--color-ink)]">
              Home
            </Link>
            <Link href="/app" className="hover:text-[var(--color-ink)]">
              Dashboard
            </Link>
            <Link href="/privacy" className="hover:text-[var(--color-ink)]">
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Dot() {
  return (
    <span
      aria-hidden
      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
    />
  );
}
