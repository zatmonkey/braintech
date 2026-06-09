import { NextResponse } from "next/server";
import { getSql, ensureContentSchema } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Used by the day-before "prep" cron to populate asset_url on a row that
// only has a generation prompt. Keeps the existing 9 AM publish cron
// simple — it never has to generate; assets are always ready.
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
    asset_url?: string;
    children_urls?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const date = (body.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date required YYYY-MM-DD" },
      { status: 400 },
    );
  }

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "db" }, { status: 503 });
  await ensureContentSchema(sql);

  const childrenUrls = Array.isArray(body.children_urls)
    ? JSON.stringify(body.children_urls.filter((u) => typeof u === "string"))
    : null;

  await sql`
    UPDATE content_calendar SET
      asset_url     = COALESCE(${body.asset_url ?? null}, asset_url),
      children_urls = COALESCE(${childrenUrls}::jsonb, children_urls),
      updated_at    = NOW()
    WHERE scheduled_for = ${date}::date;
  `;
  return NextResponse.json({ ok: true });
}
