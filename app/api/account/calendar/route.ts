import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, sessionCookie, isAdmin } from "@/app/lib/auth";
import { getSql, ensureContentSchema } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authedAdmin(): Promise<string | null> {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  return isAdmin(email) ? email : null;
}

export async function GET(req: Request) {
  if (!(await authedAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "db" }, { status: 503 });
  await ensureContentSchema(sql);

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : null;
  const to = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? toParam : null;

  // Default window: 7 days before today through 30 days ahead. Gives the
  // admin context on what just posted plus runway to plan ahead.
  const rows = await (from && to
    ? sql`
        SELECT scheduled_for, theme, asset_url, prompt, caption, media_type,
               aspect_ratio, posted_at, permalink, ig_media_id, error_message
        FROM content_calendar
        WHERE scheduled_for BETWEEN ${from}::date AND ${to}::date
        ORDER BY scheduled_for ASC;
      `
    : sql`
        SELECT scheduled_for, theme, asset_url, prompt, caption, media_type,
               aspect_ratio, posted_at, permalink, ig_media_id, error_message
        FROM content_calendar
        WHERE scheduled_for BETWEEN CURRENT_DATE - INTERVAL '7 days'
                                AND CURRENT_DATE + INTERVAL '30 days'
        ORDER BY scheduled_for ASC;
      `);
  return NextResponse.json({ rows });
}

export async function POST(req: Request) {
  if (!(await authedAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    scheduled_for?: string;
    theme?: string | null;
    asset_url?: string | null;
    prompt?: string | null;
    caption?: string | null;
    media_type?: string | null;
    aspect_ratio?: string | null;
    delete?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const date = (body.scheduled_for ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "scheduled_for must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "db" }, { status: 503 });
  await ensureContentSchema(sql);

  if (body.delete) {
    await sql`DELETE FROM content_calendar WHERE scheduled_for = ${date}::date;`;
    return NextResponse.json({ ok: true, deleted: true });
  }

  const mediaType =
    body.media_type === "STORIES" || body.media_type === "REELS"
      ? body.media_type
      : "IMAGE";

  // Upsert by scheduled_for (the primary key).
  await sql`
    INSERT INTO content_calendar (
      scheduled_for, theme, asset_url, prompt, caption, media_type, aspect_ratio
    ) VALUES (
      ${date}::date, ${body.theme ?? null}, ${body.asset_url ?? null},
      ${body.prompt ?? null}, ${body.caption ?? null}, ${mediaType},
      ${body.aspect_ratio ?? null}
    )
    ON CONFLICT (scheduled_for) DO UPDATE SET
      theme        = EXCLUDED.theme,
      asset_url    = EXCLUDED.asset_url,
      prompt       = EXCLUDED.prompt,
      caption      = EXCLUDED.caption,
      media_type   = EXCLUDED.media_type,
      aspect_ratio = EXCLUDED.aspect_ratio,
      updated_at   = NOW();
  `;
  return NextResponse.json({ ok: true });
}
