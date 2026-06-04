// Records a cancelled Stripe Checkout session — the visitor opened the
// session but landed back on /?reserve=cancelled instead of /reserved.
//
// Browser side (CancelTracker) fires fbq custom 'CheckoutCancelled' with
// {eventID: stripe_session_id}. This endpoint fires the matching CAPI
// event server-side so iOS/blockers don't drop the signal, AND stamps
// leads.checkout_cancelled_at so `btnet variations` can show the
// abandonment funnel.
//
// Idempotent: re-firing is safe (same event_id dedupes in Meta; DB stamp
// only sets the timestamp if it was NULL).

import { NextResponse } from "next/server";
import { getSql, ensureSmsSchema } from "@/app/lib/db";
import { sendCapiCancel, readMetaCookies } from "@/app/lib/meta-capi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = {
  sessionId?: string;
  email?: string;
  mode?: "deposit" | "purchase";
  // minor units (cents)
  valueMinor?: number;
  currency?: string;
  variation?: string | null;
};

export async function POST(req: Request) {
  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const sessionId = (body.sessionId ?? "").trim().slice(0, 200);
  const email = (body.email ?? "").trim().toLowerCase();
  const mode: "deposit" | "purchase" =
    body.mode === "purchase" ? "purchase" : "deposit";
  const currency = (body.currency ?? "usd").toLowerCase();
  const minor = Number(body.valueMinor ?? 0);
  const major = currency === "jpy" ? minor : minor / 100;
  const variation = body.variation ?? null;

  if (!email || !sessionId) {
    return NextResponse.json({ ok: false, reason: "missing fields" });
  }

  // Stamp the lead. NEVER touch deposit_paid — a webhook that arrives
  // after the cancel page (race) should win. We only set the cancellation
  // timestamp if it was NULL and the deposit isn't already paid.
  const sql = getSql();
  if (sql) {
    try {
      await ensureSmsSchema(sql);
      await sql`
        UPDATE leads SET
          checkout_cancelled_at = COALESCE(checkout_cancelled_at, NOW()),
          updated_at = NOW()
        WHERE email = ${email} AND deposit_paid = FALSE;
      `;
    } catch (err) {
      console.error("[checkout/cancel] db update failed", err);
    }
  }

  const ua = req.headers.get("user-agent")?.slice(0, 300) ?? "";
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "";

  const { fbc, fbp } = readMetaCookies(req.headers.get("cookie"));
  await sendCapiCancel({
    occurredAt: new Date(),
    eventId: sessionId, // matches the client-side {eventID: sessionId}
    email,
    ip: ip || null,
    userAgent: ua || null,
    fbc,
    fbp,
    value: major,
    currency,
    mode,
    variation,
  });

  return NextResponse.json({ ok: true });
}
