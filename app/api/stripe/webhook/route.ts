import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/app/lib/stripe";
import { getSql, ensureSmsSchema } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig ?? "", secret);
  } catch (err) {
    console.error("[stripe] bad signature", err);
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status === "paid") {
      const email = (
        session.customer_email ??
        session.customer_details?.email ??
        session.metadata?.email ??
        ""
      )
        .trim()
        .toLowerCase();
      const phone = session.metadata?.phone ?? null;
      const variation = session.metadata?.variation || null;
      const mode = session.metadata?.mode === "purchase" ? "purchase" : "deposit";
      const country =
        session.customer_details?.address?.country ??
        (
          session as unknown as {
            collected_information?: { shipping_details?: { address?: { country?: string } } };
          }
        ).collected_information?.shipping_details?.address?.country ??
        null;
      const paymentIntent =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null);

      const sql = getSql();
      if (sql && email) {
        try {
          await ensureSmsSchema(sql);
          await sql`
            INSERT INTO leads (
              email, phone, deposit_paid, deposit_amount, deposit_at,
              stripe_session_id, stripe_payment_intent, shipping_country,
              variation, checkout_mode
            ) VALUES (
              ${email}, ${phone}, TRUE, ${session.amount_total ?? null}, NOW(),
              ${session.id}, ${paymentIntent}, ${country},
              ${variation}, ${mode}
            )
            ON CONFLICT (email) DO UPDATE SET
              phone = COALESCE(leads.phone, EXCLUDED.phone),
              deposit_paid = TRUE,
              deposit_amount = EXCLUDED.deposit_amount,
              deposit_at = NOW(),
              stripe_session_id = EXCLUDED.stripe_session_id,
              stripe_payment_intent = EXCLUDED.stripe_payment_intent,
              shipping_country = COALESCE(EXCLUDED.shipping_country, leads.shipping_country),
              variation = COALESCE(leads.variation, EXCLUDED.variation),
              checkout_mode = COALESCE(EXCLUDED.checkout_mode, leads.checkout_mode),
              updated_at = NOW();
          `;
          console.log("[stripe] deposit recorded", { email, amount: session.amount_total });
        } catch (err) {
          console.error("[stripe] db update failed", err);
        }
      }
    }
  }

  return NextResponse.json({ received: true });
}
