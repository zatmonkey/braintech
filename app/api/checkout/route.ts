import { NextResponse } from "next/server";
import { getStripe, DEPOSIT_AMOUNT_CENTS, SHIP_DATE } from "@/app/lib/stripe";
import { getSql, ensureSmsSchema } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function siteUrl(req: Request): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "getbraintech.com";
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Payments are not configured yet." },
      { status: 503 },
    );
  }

  let body: { email?: string; phone?: string };
  try {
    body = (await req.json()) as { email?: string; phone?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const phone = (body.phone ?? "").trim();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const base = siteUrl(req);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: DEPOSIT_AMOUNT_CENTS,
            product_data: {
              name: "Braintech — Founding Device Reservation",
              description: `Refundable $50 deposit to lock in one of the first 1,000 devices. Ships worldwide ${SHIP_DATE}. Applied toward your $249/yr founding membership.`,
            },
          },
        },
      ],
      metadata: { email, phone },
      payment_intent_data: { metadata: { email, phone }, receipt_email: email },
      success_url: `${base}/reserved?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/?reserve=cancelled#waitlist`,
      // Capture where to ship the device.
      shipping_address_collection: {
        allowed_countries: [
          "US", "CA", "GB", "IE", "AU", "NZ", "FR", "DE", "ES", "IT", "NL",
          "BE", "AT", "CH", "SE", "NO", "DK", "FI", "PT", "PL", "CZ", "GR",
          "MX", "BR", "JP", "SG", "HK", "KR", "AE", "IL", "ZA", "IN",
        ],
      },
      allow_promotion_codes: false,
    });

    // Best-effort: record the reservation attempt against the lead.
    const sql = getSql();
    if (sql) {
      try {
        await ensureSmsSchema(sql);
        await sql`
          INSERT INTO leads (email, phone, stripe_session_id)
          VALUES (${email}, ${phone || null}, ${session.id})
          ON CONFLICT (email) DO UPDATE SET
            phone = COALESCE(EXCLUDED.phone, leads.phone),
            stripe_session_id = EXCLUDED.stripe_session_id,
            updated_at = NOW();
        `;
      } catch (err) {
        console.error("[checkout] lead upsert failed", err);
      }
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[checkout] session create failed", err);
    return NextResponse.json(
      { error: "Could not start checkout. Try again." },
      { status: 500 },
    );
  }
}
