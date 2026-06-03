import { NextResponse } from "next/server";
import { getSql, ensureVariationSchema } from "@/app/lib/db";
import { createHash } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Client-side view beacon. The page renders, then a tiny tracker fires this
 * once per (variation, visitor_id) session. visitor_id is generated in
 * sessionStorage on the client, so it's stable for the duration of the tab
 * but doesn't follow the visitor across sessions (which would over-count if
 * we counted reloads, or undercount if we counted only the first hit ever).
 *
 * ON CONFLICT DO NOTHING on (variation, visitor_id) means a noisy client
 * firing this 50 times is still one row.
 */
export async function POST(req: Request) {
  let body: { variation?: string; visitorId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const variation = String(body.variation ?? "").slice(0, 8);
  const visitorId = String(body.visitorId ?? "").slice(0, 64);
  if (!variation || !visitorId) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  // Don't store raw UA — just a short hash for rough "is this a bot wave?"
  // sanity checking. No IP storage at all.
  const ua = req.headers.get("user-agent") ?? "";
  const uaHash = ua
    ? createHash("sha256").update(ua).digest("hex").slice(0, 16)
    : null;

  const sql = getSql();
  if (!sql) return NextResponse.json({ ok: true }); // fail open — never block the page

  try {
    await ensureVariationSchema(sql);
    await sql`
      INSERT INTO variation_views (variation, visitor_id, ua_hash)
      VALUES (${variation}, ${visitorId}, ${uaHash})
      ON CONFLICT (variation, visitor_id) DO NOTHING;
    `;
  } catch (err) {
    console.error("[variation/track] insert failed", err);
  }
  return NextResponse.json({ ok: true });
}
