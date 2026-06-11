/**
 * Record a parent's decision on an app for a specific kid group.
 *
 *   POST: dashboard quick-decide buttons. Session cookie auth.
 *         Body: { group_id, app, status: 'ok'|'limit' }
 *
 *   GET : one-click email-link decision (no session required).
 *         Query: ?token=<signed>&decision=ok|limit
 *         The token is `${email}|${group_id}|${app}` HMAC-signed with
 *         SESSION_SECRET so anyone with the email but not the secret
 *         can't forge a decision URL for somebody else's account.
 *
 * Both paths funnel through writeClassification.
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import {
  getSql,
  ensureDeviceSchema,
  ensureAccountSchema,
} from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Status = "ok" | "limit";

function secret(): string {
  return process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me";
}

export function signAppDecisionToken(
  email: string,
  group_id: string,
  app: string,
): string {
  const payload = `${email}|${group_id}|${app}`;
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function verifyToken(
  email: string,
  group_id: string,
  app: string,
  token: string,
): boolean {
  if (!token || token.length !== 64) return false;
  const expected = signAppDecisionToken(email, group_id, app);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(token, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function writeClassification(
  email: string,
  group_id: string,
  app: string,
  status: Status,
  decided_by: "parent" | "bri" | "email",
) {
  const sql = getSql();
  if (!sql) throw new Error("db unavailable");
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);
  await sql`
    INSERT INTO app_classifications (owner_email, group_id, app, status, decided_by)
    VALUES (${email}, ${group_id}, ${app}, ${status}, ${decided_by})
    ON CONFLICT (owner_email, group_id, app) DO UPDATE SET
      status     = EXCLUDED.status,
      decided_by = EXCLUDED.decided_by,
      updated_at = NOW();
  `;
  // Reset the alert dedupe so a future "limit"-to-"ok" flip-flop will
  // re-alert if the kid spikes again.
  await sql`
    DELETE FROM app_alert_log
    WHERE owner_email = ${email} AND group_id = ${group_id} AND app = ${app};
  `;
}

export async function POST(req: NextRequest) {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { group_id?: string; app?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const group_id = String(body.group_id ?? "").trim();
  const app = String(body.app ?? "").slice(0, 80).trim();
  const status = String(body.status ?? "") as Status;
  if (!/^grp_[a-f0-9]{6,}$/.test(group_id)) {
    return NextResponse.json({ error: "bad group_id" }, { status: 400 });
  }
  if (!app) {
    return NextResponse.json({ error: "app required" }, { status: 400 });
  }
  if (status !== "ok" && status !== "limit") {
    return NextResponse.json({ error: "status must be ok|limit" }, { status: 400 });
  }
  try {
    await writeClassification(email, group_id, app, status, "parent");
  } catch (err) {
    return NextResponse.json(
      { error: "write failed", message: (err as Error).message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, status });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const email = (url.searchParams.get("email") ?? "").toLowerCase().trim();
  const group_id = (url.searchParams.get("group_id") ?? "").trim();
  const app = (url.searchParams.get("app") ?? "").trim();
  const token = (url.searchParams.get("token") ?? "").trim();
  const decision = (url.searchParams.get("decision") ?? "") as Status;
  if (!email || !group_id || !app || !token) {
    return NextResponse.json({ error: "missing params" }, { status: 400 });
  }
  if (decision !== "ok" && decision !== "limit") {
    return NextResponse.json({ error: "bad decision" }, { status: 400 });
  }
  if (!verifyToken(email, group_id, app, token)) {
    return NextResponse.json({ error: "bad token" }, { status: 401 });
  }
  try {
    await writeClassification(email, group_id, app, decision, "email");
  } catch (err) {
    return NextResponse.json(
      { error: "write failed", message: (err as Error).message },
      { status: 500 },
    );
  }
  // Land them on /app with a confirmation banner.
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://getbraintech.com");
  return NextResponse.redirect(
    `${base}/app?classified=${encodeURIComponent(app)}&status=${decision}`,
    303,
  );
}
