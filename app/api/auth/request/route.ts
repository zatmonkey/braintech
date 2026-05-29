import { NextResponse } from "next/server";
import { getSql, ensureAuthSchema } from "@/app/lib/db";
import { newOtp, hashOtp } from "@/app/lib/auth";
import { sendOtpEmail } from "@/app/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
  }

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await ensureAuthSchema(sql);

  const code = newOtp();
  const codeHash = hashOtp(email, code);
  await sql`
    INSERT INTO otps (email, code_hash, expires_at, attempts)
    VALUES (${email}, ${codeHash}, NOW() + INTERVAL '10 minutes', 0)
    ON CONFLICT (email) DO UPDATE SET
      code_hash = EXCLUDED.code_hash,
      expires_at = EXCLUDED.expires_at,
      attempts = 0,
      created_at = NOW();
  `;

  const { delivered } = await sendOtpEmail(email, code);

  // In dev (no email provider), surface the code so login is testable.
  // Never echo the code back in production — even if delivery fails, fail closed.
  if (!delivered && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Couldn't send code right now — try again in a moment." },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    delivered,
    ...(delivered ? {} : { devCode: code }),
  });
}
