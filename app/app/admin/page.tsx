import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { verifySession, sessionCookie, isAdmin } from "@/app/lib/auth";
import {
  getSql,
  ensureSmsSchema,
  ensureAccountSchema,
  ensureContentSchema,
  ensureVariationSchema,
} from "@/app/lib/db";
import { VIDEO_CATALOG } from "@/app/lib/video-catalog";
import { loadHubStats, formatMoney } from "@/app/lib/admin-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  title: "Admin · Braintech",
  robots: { index: false, follow: false },
};

export default async function AdminHub() {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) redirect("/login?from=/admin");
  if (!isAdmin(email)) redirect("/app");

  const sql = getSql();
  let stats: Awaited<ReturnType<typeof loadHubStats>> | null = null;
  if (sql) {
    await ensureSmsSchema(sql);
    await ensureAccountSchema(sql);
    await ensureContentSchema(sql);
    await ensureVariationSchema(sql);
    stats = await loadHubStats(
      sql,
      VIDEO_CATALOG.map((v) => v.id),
    );
  }

  // Pre-format the headline stat strings here so the JSX stays flat.
  const contentStat =
    stats?.nextContentPostDays === null || stats?.nextContentPostDays === undefined
      ? "nothing scheduled"
      : stats.nextContentPostDays === 0
        ? "next post today"
        : stats.nextContentPostDays === 1
          ? "next post tomorrow"
          : `next post in ${stats.nextContentPostDays}d`;

  const earnStat = stats
    ? `${stats.videoCount} video${stats.videoCount === 1 ? "" : "s"}, ${stats.videosWatched} watched`
    : "—";

  const revenueParts = stats?.revenue7dByCurrency.length
    ? stats.revenue7dByCurrency
        .map((r) => formatMoney(r.amount, r.currency))
        .join(" / ")
    : "$0";
  const businessStat = stats
    ? `${revenueParts} in last 7d · ${stats.signups7d} signup${stats.signups7d === 1 ? "" : "s"}`
    : "—";

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10 sm:py-14">
      <header className="mb-10 flex items-end justify-between gap-4">
        <div>
          <Link
            href="/app"
            className="text-xs uppercase tracking-wider text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
          >
            ← Back to your braintech
          </Link>
          <h1 className="serif mt-2 text-3xl tracking-tight sm:text-4xl">
            Admin
          </h1>
          <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
            Signed in as <strong>{email}</strong>. Founder-only surfaces.
          </p>
        </div>
      </header>

      {!sql && (
        <p className="rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)] p-4 text-sm text-[var(--color-ink-soft)]">
          Database unavailable — stats hidden.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AdminCard
          href="/app/calendar"
          title="Content calendar"
          summary="Scheduled IG / FB posts and the daily cron status."
          stat={contentStat}
        />
        <AdminCard
          href="/app/admin/earn"
          title="Earn content"
          summary="TED / TED-Ed catalog kids can watch to earn brain credits."
          stat={earnStat}
        />
        <AdminCard
          href="/app/admin/business"
          title="Business"
          summary="Revenue, funnel, A/B, recent orders + signups."
          stat={businessStat}
        />
      </div>
    </main>
  );
}

function AdminCard({
  href,
  title,
  summary,
  stat,
}: {
  href: string;
  title: string;
  summary: string;
  stat: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-[var(--color-rule)] bg-white p-5 transition hover:border-[var(--color-accent)] hover:shadow-sm"
    >
      <h2 className="serif text-xl tracking-tight text-[var(--color-ink)]">
        {title}
      </h2>
      <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{summary}</p>
      <p className="mt-4 font-mono text-xs text-[var(--color-accent)]">
        {stat}
      </p>
    </Link>
  );
}
