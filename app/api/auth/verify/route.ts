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

  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie.name, signSession(email), sessionCookie.options);
  return res;
}
