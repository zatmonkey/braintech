/**
 * Per-group app activity for the dashboard "Activity" modal.
 * Returns the top apps with minutes_today + minutes_7d + classification
 * status, sorted by 7d minutes desc.
 *
 * Lazy — fetched only when the parent opens the modal, not on every
 * /api/account/state poll.
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import {
  getSql,
  ensureDeviceSchema,
  ensureAccountSchema,
} from "@/app/lib/db";
import { loadGroupActivity } from "@/app/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const group_id = (url.searchParams.get("group_id") ?? "").trim();
  if (!/^grp_[a-f0-9]{6,}$/.test(group_id)) {
    return NextResponse.json({ error: "bad group_id" }, { status: 400 });
  }
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "db unavailable" }, { status: 503 });
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);

  // Ownership: the group must belong to the authed account.
  const owned = (await sql`
    SELECT 1 FROM account_groups
    WHERE owner_email = ${email} AND group_id = ${group_id} LIMIT 1;
  `) as { 1: number }[];
  if (owned.length === 0) {
    return NextResponse.json({ error: "not your group" }, { status: 404 });
  }

  const apps = await loadGroupActivity(sql, email, group_id);
  return NextResponse.json({ ok: true, group_id, apps });
}
