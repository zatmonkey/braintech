import Link from "next/link";
import type { Metadata } from "next";
import { EarnFlow } from "./earn-flow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Earn brain credits",
  description:
    "Show what you learned and earn screen-time credits. Kid-side flow served from the home Wi-Fi.",
  robots: { index: false, follow: false },
};

export default async function EarnPage({
  searchParams,
}: {
  searchParams?: Promise<{ mac?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const macRaw = (sp.mac ?? "").trim().toLowerCase();
  const macOk = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(macRaw);

  return (
    <main className="flex min-h-screen flex-col">
      <nav className="mx-auto flex w-full max-w-2xl items-center justify-between px-6 py-6">
        <Link href={macOk ? `/mine?mac=${macRaw}` : "/mine"} className="flex items-center gap-2">
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
          href={macOk ? `/mine?mac=${macRaw}` : "/mine"}
          className="text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
        >
          ← My setup
        </Link>
      </nav>

      <section className="mx-auto w-full max-w-2xl flex-1 px-6 py-6 sm:py-10">
        <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
          Earn brain credits
        </div>
        <h1 className="serif mt-4 text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
          Show what you learned.
        </h1>
        <p className="mt-4 max-w-lg text-lg leading-relaxed text-[var(--color-ink-soft)]">
          Pick what you did, answer three short questions about it, and
          credits land in your pool. The credits get spent automatically
          when you hit your daily limit on YouTube / TikTok / whatever.
        </p>

        {!macOk ? (
          <div className="mt-8 rounded-2xl border border-[var(--color-rule)] bg-white p-5 text-[var(--color-ink-soft)]">
            We couldn&rsquo;t tell which device you&rsquo;re on. Type{" "}
            <code className="rounded bg-[var(--color-cream)] px-1.5 py-0.5 text-sm">
              http://brain
            </code>{" "}
            in any browser on the home Wi-Fi and follow the link from
            there — it&rsquo;ll bring you back here with the right device.
          </div>
        ) : (
          <EarnFlow mac={macRaw} />
        )}
      </section>

      <footer className="border-t border-[var(--color-rule)] bg-white">
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-xs text-[var(--color-ink-soft)]">
          <span>© {new Date().getFullYear()} Braintech</span>
          <Link href="/" className="hover:text-[var(--color-ink)]">
            Home
          </Link>
        </div>
      </footer>
    </main>
  );
}
