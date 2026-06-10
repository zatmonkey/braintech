import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "What's set up on this device",
  description:
    "See what your home Braintech device has blocked or paused on this connection.",
  robots: { index: false, follow: false },
};

type Rule = {
  rule_id: string;
  rule_type: string;
  name: string;
  summary: string | null;
  scope: "device" | "group" | "network";
  group_name?: string;
};

type MineResponse =
  | {
      ok: true;
      mac: string;
      label: string | null;
      groups: { group_id: string; name: string }[];
      rules: Rule[];
      seen_recently: boolean;
    }
  | { ok: false; reason: string };

async function fetchMine(mac: string, baseUrl: string): Promise<MineResponse> {
  try {
    const r = await fetch(
      `${baseUrl}/api/account/mine?mac=${encodeURIComponent(mac)}`,
      { cache: "no-store" },
    );
    if (!r.ok) return { ok: false, reason: `status ${r.status}` };
    return (await r.json()) as MineResponse;
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

export default async function MinePage({
  searchParams,
}: {
  searchParams?: Promise<{ mac?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const macRaw = (sp.mac ?? "").trim().toLowerCase();
  const macOk = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(macRaw);

  // Build the base URL from the same Vercel deployment we're in.
  // process.env.VERCEL_URL is the deploy URL; locally falls back to the
  // dev server.
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  const data = macOk ? await fetchMine(macRaw, baseUrl) : null;

  return (
    <main className="flex min-h-screen flex-col">
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

      <section className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 sm:py-14">
        <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
          This device on the home Wi-Fi
        </div>
        <h1 className="serif mt-4 text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
          What&rsquo;s set up here.
        </h1>

        {!macOk && (
          <div className="mt-8 rounded-2xl border border-[var(--color-rule)] bg-white p-5">
            <p className="text-[var(--color-ink-soft)]">
              We couldn&rsquo;t identify this device. Try typing{" "}
              <code className="rounded bg-[var(--color-cream)] px-1.5 py-0.5 text-sm">
                http://brain
              </code>{" "}
              from a device on your home Wi-Fi — the Braintech box will
              redirect you back here with the right device.
            </p>
          </div>
        )}

        {data?.ok === false && (
          <div className="mt-8 rounded-2xl border border-[var(--color-rule)] bg-white p-5 text-[var(--color-ink-soft)]">
            We couldn&rsquo;t look up this device right now. Try refreshing,
            or sign in at{" "}
            <Link href="/app" className="text-[var(--color-accent)] underline">
              /app
            </Link>{" "}
            to manage rules.
          </div>
        )}

        {data?.ok === true && (
          <>
            {/* Identity */}
            <div className="mt-8 rounded-2xl border border-[var(--color-rule)] bg-white p-5">
              <div className="flex items-baseline justify-between gap-3">
                <div className="font-semibold text-[var(--color-ink)]">
                  {data.label ?? "Unnamed device"}
                </div>
                <span
                  className={`text-xs font-medium uppercase tracking-wider ${
                    data.seen_recently
                      ? "text-emerald-700"
                      : "text-[var(--color-ink-soft)]"
                  }`}
                >
                  {data.seen_recently ? "Connected now" : "Recently seen"}
                </span>
              </div>
              <div className="mt-1 font-mono text-xs text-[var(--color-ink-soft)]">
                {data.mac}
              </div>
              {data.groups.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="text-[var(--color-ink-soft)]">In group:</span>
                  {data.groups.map((g) => (
                    <span
                      key={g.group_id}
                      className="rounded-full bg-[var(--color-cream)] px-2 py-0.5 font-medium uppercase tracking-wider"
                    >
                      {g.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Rules affecting this device */}
            <div className="mt-6">
              <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
                What&rsquo;s active for this device
              </div>
              {data.rules.length === 0 ? (
                <div className="mt-3 rounded-2xl border border-[var(--color-rule)] bg-white p-5 text-[var(--color-ink-soft)]">
                  Nothing is being filtered for this device right now.
                  Normal internet, no rules in place. 👍
                </div>
              ) : (
                <ul className="mt-3 space-y-3">
                  {data.rules.map((r) => (
                    <li
                      key={r.rule_id}
                      className="rounded-2xl border border-[var(--color-rule)] bg-white p-5"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold text-[var(--color-ink)]">
                          {r.name}
                        </span>
                        <span className="text-xs uppercase tracking-wider text-[var(--color-ink-soft)]">
                          {scopeLabel(r.scope, r.group_name)}
                        </span>
                      </div>
                      {r.summary && (
                        <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">
                          {r.summary}
                        </p>
                      )}
                      <div className="mt-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-accent)]">
                        {r.rule_type.replace(/_/g, " ")}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {/* Bottom note */}
        <div className="mt-12 rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)]/40 p-5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          <p>
            Want to change something here? Sign in to your dashboard at{" "}
            <Link
              href="/app"
              className="font-medium text-[var(--color-accent)] hover:underline"
            >
              getbraintech.com/app
            </Link>{" "}
            and adjust the rule — or text Bri (&ldquo;unlock YouTube for an
            hour&rdquo; works).
          </p>
        </div>
      </section>

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
            <Link href="/blocked" className="hover:text-[var(--color-ink)]">
              Blocked page
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

function scopeLabel(scope: Rule["scope"], groupName?: string): string {
  if (scope === "device") return "On this device";
  if (scope === "group" && groupName) return `Via ${groupName} group`;
  if (scope === "group") return "Via group";
  return "Whole network";
}
