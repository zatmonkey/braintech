import { NextResponse } from "next/server";
import { getSql, ensureContentSchema } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authed(req: Request): boolean {
  const secret = process.env.CONTENT_CALENDAR_SECRET;
  if (!secret) return false;
  const url = new URL(req.url);
  const provided =
    url.searchParams.get("key") ?? req.headers.get("x-content-key");
  return provided === secret;
}

export async function POST(req: Request) {
  if (!authed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    date?: string;
    permalink?: string | null;
    ig_media_id?: string | null;
    error_message?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const date = (body.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date required YYYY-MM-DD" }, { status: 400 });
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ error: "db unavailable" }, { status: 503 });
  }
  await ensureContentSchema(sql);

  const errorMessage = body.error_message ?? null;
  // Only stamp posted_at on success (no error_message). Errors leave it
  // NULL so a manual retry / next-day fallback can re-pick the row.
  await sql`
    UPDATE content_calendar SET
      posted_at = CASE WHEN ${errorMessage}::text IS NULL THEN NOW() ELSE posted_at END,
      permalink = COALESCE(${body.permalink ?? null}, permalink),
      ig_media_id = COALESCE(${body.ig_media_id ?? null}, ig_media_id),
      error_message = ${errorMessage},
      updated_at = NOW()
    WHERE scheduled_for = ${date}::date;
  `;
  return NextResponse.json({ ok: true });
}
