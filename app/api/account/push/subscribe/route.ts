/**
 * Register / re-register a browser push subscription against the
 * authed parent's account. Idempotent — same endpoint replaces its
 * row (key rotation is handled by the push service).
 *
 * Body:
 *   { endpoint, keys: { p256dh, auth } }  // from PushSubscription.toJSON()
 *
 * GET returns the VAPID public key so the client can call
 * pushManager.subscribe() without us shipping it in a NEXT_PUBLIC_
 * env (Vercel does inject NEXT_PUBLIC_*, but this endpoint also
 * insulates the client from a missing key by returning a 503).
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import {
  getSql,
  ensureDeviceSchema,
  ensureAccountSchema,
} from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
  if (!key) {
    return NextResponse.json(
      { error: "push not configured" },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, vapid_public_key: key });
}

export async function POST(req: NextRequest) {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const endpoint = String(body.endpoint ?? "").trim();
  const p256dh = String(body.keys?.p256dh ?? "").trim();
  const auth = String(body.keys?.auth ?? "").trim();
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "missing endpoint or keys" }, { status: 400 });
  }
  const ua = req.headers.get("user-agent")?.slice(0, 300) ?? null;

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "db unavailable" }, { status: 503 });
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);

  await sql`
    INSERT INTO push_subscriptions (endpoint, owner_email, p256dh_key, auth_key, user_agent)
    VALUES (${endpoint}, ${email}, ${p256dh}, ${auth}, ${ua})
    ON CONFLICT (endpoint) DO UPDATE SET
      owner_email  = EXCLUDED.owner_email,
      p256dh_key   = EXCLUDED.p256dh_key,
      auth_key     = EXCLUDED.auth_key,
      user_agent   = EXCLUDED.user_agent,
      last_seen_at = NOW();
  `;
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const endpoint = (url.searchParams.get("endpoint") ?? "").trim();
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "db unavailable" }, { status: 503 });
  await sql`
    DELETE FROM push_subscriptions
    WHERE owner_email = ${email} AND endpoint = ${endpoint};
  `;
  return NextResponse.json({ ok: true });
}
