import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { verifySession, sessionCookie, isAdmin } from "@/app/lib/auth";
import { getSql, ensureContentSchema } from "@/app/lib/db";
import { CalendarClient, type CalendarRow } from "./calendar-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Content calendar · Braintech",
  robots: { index: false, follow: false },
};

export default async function CalendarPage() {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) redirect("/login?from=/app/calendar");
  if (!isAdmin(email)) redirect("/app");

  const sql = getSql();
  if (!sql) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <p className="text-[var(--color-ink-soft)]">Database unavailable.</p>
      </main>
    );
  }
  await ensureContentSchema(sql);

  // Default window: 7d back + 30d forward.
  const rows = (await sql`
    SELECT scheduled_for::text AS scheduled_for, theme, asset_url, prompt,
           caption, media_type, aspect_ratio, posted_at, permalink, ig_media_id,
           error_message
    FROM content_calendar
    WHERE scheduled_for BETWEEN CURRENT_DATE - INTERVAL '7 days'
                            AND CURRENT_DATE + INTERVAL '30 days'
    ORDER BY scheduled_for ASC;
  `) as CalendarRow[];

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10 sm:py-14">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <a
            href="/app"
            className="text-xs uppercase tracking-wider text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
          >
            ← Back to your braintech
          </a>
          <h1 className="serif mt-2 text-3xl tracking-tight sm:text-4xl">
            Content calendar
          </h1>
          <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
            Signed in as <strong>{email}</strong> · daily cron fires 9 AM PT.
            Rows without an asset URL are skipped silently by the routine.
          </p>
        </div>
      </header>

      <CalendarClient initialRows={rows} />
    </main>
  );
}
