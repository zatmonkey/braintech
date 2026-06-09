import { NextResponse } from "next/server";
import { getSql, ensureContentSchema } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shared-secret auth for the daily-cron routine. The routine knows the
// secret and passes it as `?key=<secret>`. No leak-blast-radius beyond
// "an attacker can see today's planned post" — the calendar isn't
// confidential, but we don't want it publicly indexable either.
function authed(req: Request): boolean {
  const secret = process.env.CONTENT_CALENDAR_SECRET;
  if (!secret) return false;
  const url = new URL(req.url);
  const provided =
    url.searchParams.get("key") ?? req.headers.get("x-content-key");
  return provided === secret;
}

export async function GET(req: Request) {
  if (!authed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ error: "db unavailable" }, { status: 503 });
  }
  await ensureContentSchema(sql);

  // Override for testing: ?date=YYYY-MM-DD. Otherwise the row for today (UTC).
  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const targetDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;

  const rows = (await (targetDate
    ? sql`
        SELECT scheduled_for, theme, prompt, asset_url, caption,
               media_type, aspect_ratio, posted_at, permalink,
               children_urls, cross_post_fb
        FROM content_calendar
        WHERE scheduled_for = ${targetDate}::date
        LIMIT 1;
      `
    : sql`
        SELECT scheduled_for, theme, prompt, asset_url, caption,
               media_type, aspect_ratio, posted_at, permalink,
               children_urls, cross_post_fb
        FROM content_calendar
        WHERE scheduled_for = CURRENT_DATE
        LIMIT 1;
      `)) as Array<{
    scheduled_for: string;
    theme: string | null;
    prompt: string | null;
    asset_url: string | null;
    caption: string | null;
    media_type: string;
    aspect_ratio: string | null;
    posted_at: string | null;
    permalink: string | null;
    children_urls: string[] | null;
    cross_post_fb: boolean;
  }>;

  if (rows.length === 0) {
    return NextResponse.json({ error: "no content for date" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}
