import { NextResponse } from "next/server";
import { getStripe, SHIP_DATE } from "@/app/lib/stripe";
import { getSql, ensureSmsSchema } from "@/app/lib/db";
import { pricingForCountry, stripeAmount } from "@/app/lib/pricing";
import { readMetaCookies } from "@/app/lib/meta-capi";

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

  let body: {
    email?: string;
    phone?: string;
    variation?: string;
    mode?: "deposit" | "purchase";
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const phone = (body.phone ?? "").trim();
  // Prefer the variation passed on the body (set by the client from the
  // active page state). Fall back to the bt_var cookie so deposits made via
  // direct API hits still attribute correctly.
  const variation = (
    body.variation ?? req.headers.get("cookie")?.match(/(?:^|;\s*)bt_var=(\d+)/)?.[1] ?? ""
  ).slice(0, 8);
  // Two flavours of checkout:
  //   - "deposit"  → $50, refundable, holds a queue spot (default; matches
  //                  the old behaviour so existing CTAs don't change)
  //   - "purchase" → $249/yr full membership, device included, no queue;
  //                  the buy-now variation uses this.
  const mode: "deposit" | "purchase" =
    body.mode === "purchase" ? "purchase" : "deposit";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const base = siteUrl(req);

  // Server is the only authority on price — never trust client-supplied
  // amounts. Country detection mirrors page.tsx: cookie first (set on the
  // visitor's previous /  hit), then Vercel's IP-country header.
  const country =
    req.headers.get("cookie")?.match(/(?:^|;\s*)bt_geo=([A-Za-z]{2})/)?.[1] ??
    req.headers.get("x-vercel-ip-country") ??
    "US";
  const pricing = pricingForCountry(country);
  const { amount: unitAmount, currency: stripeCurrency } = stripeAmount(
    pricing,
    mode,
  );

  try {
    const isPurchase = mode === "purchase";
    const lineItem = isPurchase
      ? {
          name: "Braintech — Founding Membership (Year 1)",
          description: `${pricing.purchaseLabel} founding membership. Device included, ships worldwide ${SHIP_DATE}. Founding price locked at every renewal.`,
        }
      : {
          name: "Braintech — Founding Device Reservation",
          description: `Refundable ${pricing.depositLabel} deposit to lock in one of the first 1,000 devices. Ships worldwide ${SHIP_DATE}. Applied toward your ${pricing.purchaseLabel} founding membership.`,
        };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: stripeCurrency,
            unit_amount: unitAmount,
            product_data: {
              name: lineItem.name,
              description: lineItem.description,
            },
          },
        },
      ],
      // mode goes into metadata so the webhook can tell deposits from full
      // purchases (different downstream emails, different lead state).
      // fbc/fbp ride along because the webhook is server-to-server (Stripe
      // → us) and so can't read the user's cookies directly — without
      // these the Purchase CAPI fire would lose paid-attribution match.
      metadata: (() => {
        const { fbc, fbp } = readMetaCookies(req.headers.get("cookie"));
        return {
          email,
          phone,
          variation,
          mode,
          country: pricing.country,
          currency: pricing.currency,
          ...(fbc ? { fbc } : {}),
          ...(fbp ? { fbp } : {}),
        };
      })(),
      payment_intent_data: {
        metadata: (() => {
          const { fbc, fbp } = readMetaCookies(req.headers.get("cookie"));
          return {
            email,
            phone,
            variation,
            mode,
            country: pricing.country,
            currency: pricing.currency,
            ...(fbc ? { fbc } : {}),
            ...(fbp ? { fbp } : {}),
          };
        })(),
        receipt_email: email,
      },
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
          INSERT INTO leads (
            email, phone, stripe_session_id, variation, checkout_mode,
            billing_country, currency
          ) VALUES (
            ${email}, ${phone || null}, ${session.id},
            ${variation || null}, ${mode},
            ${pricing.country}, ${pricing.currency.toLowerCase()}
          )
          ON CONFLICT (email) DO UPDATE SET
            phone = COALESCE(EXCLUDED.phone, leads.phone),
            stripe_session_id = EXCLUDED.stripe_session_id,
            variation = COALESCE(leads.variation, EXCLUDED.variation),
            checkout_mode = EXCLUDED.checkout_mode,
            billing_country = COALESCE(leads.billing_country, EXCLUDED.billing_country),
            currency = COALESCE(leads.currency, EXCLUDED.currency),
            updated_at = NOW();
        `;
      } catch (err) {
        console.error("[checkout] lead upsert failed", err);
      }
    }

    return NextResponse.json({
      url: session.url,
      // Echo back so the client can stash these in sessionStorage; the
      // CancelTracker reads them when the visitor lands on
      // /?reserve=cancelled and fires the abandonment events.
      session_id: session.id,
      mode,
      value: unitAmount,
      currency: stripeCurrency,
      variation: variation || null,
    });
  } catch (err) {
    console.error("[checkout] session create failed", err);
    return NextResponse.json(
      { error: "Could not start checkout. Try again." },
      { status: 500 },
    );
  }
}
