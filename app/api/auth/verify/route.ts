import { NextResponse } from "next/server";
import { getSql, ensureAuthSchema } from "@/app/lib/db";
import { hashOtp, signSession, sessionCookie } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { email?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const code = (body.code ?? "").trim();
  if (!email || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the 6-digit code" }, { status: 400 });
  }

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await ensureAuthSchema(sql);

  const rows = (await sql`
    SELECT code_hash, attempts, expires_at < NOW() AS expired
    FROM otps WHERE email = ${email};
  `) as { code_hash: string; attempts: number; expired: boolean }[];
  const row = rows[0];
  if (!row || row.expired || row.attempts >= 5) {
    return NextResponse.json({ error: "Code expired — request a new one" }, { status: 400 });
  }
  if (row.code_hash !== hashOtp(email, code)) {
    await sql`UPDATE otps SET attempts = attempts + 1 WHERE email = ${email};`;
    return NextResponse.json({ error: "Incorrect code" }, { status: 400 });
  }

  // success — consume the code, link any unclaimed device, set the session
  await sql`DELETE FROM otps WHERE email = ${email};`;

  // If `email` was invited as a co-admin on someone's household, the
  // session represents the household, not them. They get to act AS the
  // owner — all the existing owner_email-scoped queries keep working.
  // Picks the most-recently-accepted household if they're an admin on
  // more than one (rare for the demo but defensible).
  const adminRows = (await sql`
    SELECT owner_email, accepted_at FROM account_admins
    WHERE LOWER(admin_email) = ${email}
    ORDER BY accepted_at NULLS LAST, invited_at DESC LIMIT 1;
  `) as { owner_email: string; accepted_at: string | null }[];
  const householdEmail = adminRows[0]?.owner_email ?? email;
  if (adminRows[0] && !adminRows[0].accepted_at) {
    await sql`
      UPDATE account_admins SET accepted_at = NOW()
      WHERE owner_email = ${householdEmail} AND LOWER(admin_email) = ${email};
    `;
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie.name, signSession(householdEmail), sessionCookie.options);
  return res;
}
