/**
 * Multi-admin management for a household.
 *
 *   GET    → list of admins on the current household (primary owner +
 *            any invited co-admins, with pending/accepted status)
 *   POST   → invite an email as co-admin (sends invite mail, idempotent
 *            on conflict)
 *   DELETE → revoke a co-admin (cannot remove the primary owner)
 *
 * Session cookie carries the household email (see /api/auth/verify),
 * so any admin can manage other admins. The primary owner is special
 * only in that they can't be deleted from the list.
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import {
  getSql,
  ensureAuthSchema,
  ensureSmsSchema,
} from "@/app/lib/db";
import { sendAdminInviteEmail } from "@/app/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function GET() {
  const store = await cookies();
  const householdEmail = verifySession(store.get(sessionCookie.name)?.value);
  if (!householdEmail) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "db unavailable" }, { status: 503 });
  await ensureSmsSchema(sql);
  await ensureAuthSchema(sql);

  const rows = (await sql`
    SELECT admin_email, invited_at, accepted_at, invited_by
    FROM account_admins
    WHERE owner_email = ${householdEmail}
    ORDER BY invited_at ASC;
  `) as {
    admin_email: string;
    invited_at: string;
    accepted_at: string | null;
    invited_by: string | null;
  }[];

  return NextResponse.json({
    ok: true,
    primary: householdEmail,
    admins: [
      // Primary always appears first.
      {
        email: householdEmail,
        role: "primary" as const,
        invited_at: null,
        accepted_at: null,
        invited_by: null,
      },
      ...rows.map((r) => ({
        email: r.admin_email,
        role: "admin" as const,
        invited_at: r.invited_at,
        accepted_at: r.accepted_at,
        invited_by: r.invited_by,
      })),
    ],
  });
}

export async function POST(req: NextRequest) {
  const store = await cookies();
  const householdEmail = verifySession(store.get(sessionCookie.name)?.value);
  if (!householdEmail) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const target = (body.email ?? "").trim().toLowerCase();
  if (!isEmail(target)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  if (target === householdEmail.toLowerCase()) {
    return NextResponse.json(
      { error: "that email is already the primary owner" },
      { status: 409 },
    );
  }
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "db unavailable" }, { status: 503 });
  await ensureAuthSchema(sql);

  // Refuse if this email is already a primary owner of a different
  // household — collisions there mean a person on TWO households needs
  // a real multi-tenant story we don't have yet. (Demo guard.)
  const conflict = (await sql`
    SELECT 1 FROM account_admins
    WHERE LOWER(admin_email) = ${target} AND owner_email <> ${householdEmail}
    LIMIT 1;
  `) as { 1: number }[];
  if (conflict.length > 0) {
    return NextResponse.json(
      { error: "that email is already an admin on another household" },
      { status: 409 },
    );
  }

  await sql`
    INSERT INTO account_admins (owner_email, admin_email, invited_by)
    VALUES (${householdEmail}, ${target}, ${householdEmail})
    ON CONFLICT (owner_email, admin_email) DO NOTHING;
  `;
  try {
    await sendAdminInviteEmail(target, {
      invited_by: householdEmail,
      household: householdEmail,
    });
  } catch (err) {
    console.error("[admins] invite send failed", err);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const store = await cookies();
  const householdEmail = verifySession(store.get(sessionCookie.name)?.value);
  if (!householdEmail) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const target = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!isEmail(target)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  if (target === householdEmail.toLowerCase()) {
    return NextResponse.json(
      { error: "can't remove the primary owner" },
      { status: 409 },
    );
  }
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "db unavailable" }, { status: 503 });
  await ensureAuthSchema(sql);

  await sql`
    DELETE FROM account_admins
    WHERE owner_email = ${householdEmail} AND LOWER(admin_email) = ${target};
  `;
  return NextResponse.json({ ok: true });
}
