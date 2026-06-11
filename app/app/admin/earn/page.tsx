import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { verifySession, sessionCookie, isAdmin } from "@/app/lib/auth";
import { getSql, ensureAccountSchema } from "@/app/lib/db";
import { VIDEO_CATALOG, type CatalogVideo } from "@/app/lib/video-catalog";
import { loadEarnVideoStats, type EarnVideoStats } from "@/app/lib/admin-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  title: "Earn content · Braintech admin",
  robots: { index: false, follow: false },
};

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export default async function EarnAdmin() {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) redirect("/login?from=/admin/earn");
  if (!isAdmin(email)) redirect("/app");

  const sql = getSql();
  let stats = new Map<string, EarnVideoStats>();
  if (sql) {
    await ensureAccountSchema(sql);
    stats = await loadEarnVideoStats(sql);
  }

  const videos = VIDEO_CATALOG;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 sm:py-14">
      <header className="mb-8">
        <Link
          href="/app/admin"
          className="text-xs uppercase tracking-wider text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
        >
          ← Admin
        </Link>
        <h1 className="serif mt-2 text-3xl tracking-tight sm:text-4xl">
          Earn content
        </h1>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          The catalog of TED / TED-Ed videos kids can watch to earn brain
          credits. Read-only — edit titles, blurbs, or credit values in{" "}
          <code className="rounded bg-[var(--color-cream)] px-1.5 py-0.5 text-xs">
            scripts/earn-videos-curation.json
          </code>{" "}
          and re-run{" "}
          <code className="rounded bg-[var(--color-cream)] px-1.5 py-0.5 text-xs">
            scripts/fetch-earn-videos.sh
          </code>
          .
        </p>
      </header>

      {videos.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-4">
          {videos.map((v) => (
            <VideoRow key={v.id} video={v} stats={stats.get(v.id)} />
          ))}
        </ul>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--color-rule)] bg-[var(--color-cream)] p-8 text-center text-sm text-[var(--color-ink-soft)]">
      <p className="font-medium text-[var(--color-ink)]">
        Catalog is empty.
      </p>
      <p className="mt-2">
        The fetcher (
        <code className="rounded bg-white px-1.5 py-0.5 text-xs">
          scripts/fetch-earn-videos.sh
        </code>
        ) hasn&apos;t resolved any videos yet. Add entries to{" "}
        <code className="rounded bg-white px-1.5 py-0.5 text-xs">
          scripts/earn-videos-curation.json
        </code>{" "}
        and re-run it to populate the generated JSON.
      </p>
    </div>
  );
}

function VideoRow({
  video,
  stats,
}: {
  video: CatalogVideo;
  stats: EarnVideoStats | undefined;
}) {
  const attempts = stats?.attempts ?? 0;
  const passes = stats?.passes ?? 0;
  const watchers = stats?.watchers ?? [];
  // YouTube thumbnails are CDN-hosted and not subject to our content
  // blocking — safe to embed directly.
  const thumbUrl = `https://i.ytimg.com/vi/${video.youtube_id}/mqdefault.jpg`;

  return (
    <li className="rounded-2xl border border-[var(--color-rule)] bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* Thumbnail */}
        <div className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbUrl}
            alt=""
            width={320}
            height={180}
            className="aspect-video w-full rounded-lg object-cover sm:w-[200px]"
            loading="lazy"
          />
        </div>

        {/* Body */}
        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="serif text-lg leading-tight tracking-tight text-[var(--color-ink)]">
              {video.title}
            </h2>
            <span className="text-xs uppercase tracking-wider text-[var(--color-ink-soft)]">
              {video.source}
            </span>
          </div>
          <p className="text-sm text-[var(--color-ink-soft)]">
            <span className="font-medium text-[var(--color-ink)]">
              {video.speaker}
            </span>{" "}
            · {fmtDuration(video.duration_seconds)} · {video.credit_pass}{" "}
            credits on a pass
          </p>
          <p className="text-sm text-[var(--color-ink)]">{video.blurb}</p>
          <div className="flex flex-wrap gap-1.5">
            {video.topics.map((t) => (
              <span
                key={t}
                className="rounded-full bg-[var(--color-cream)] px-2 py-0.5 text-xs text-[var(--color-ink-soft)]"
              >
                {t}
              </span>
            ))}
          </div>

          {/* Stats strip */}
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--color-rule)] pt-3 text-xs">
            <Stat label="Attempts" value={String(attempts)} />
            <Stat
              label="Passes"
              value={
                attempts === 0
                  ? "—"
                  : `${passes} (${Math.round((passes / attempts) * 100)}%)`
              }
            />
            <Stat
              label="Watchers"
              value={watchers.length === 0 ? "none yet" : watchers.join(", ")}
            />
          </div>
        </div>
      </div>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-[var(--color-ink-soft)]">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-xs text-[var(--color-ink)]">
        {value}
      </dd>
    </div>
  );
}
