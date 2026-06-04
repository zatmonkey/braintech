import { createHash } from "crypto";

/**
 * Meta Conversions API — server-to-server event firing.
 *
 * Why we need this on top of the browser Pixel:
 *  - iOS Limit-Ad-Tracking, content blockers, and Firefox-by-default all
 *    drop Pixel JS. We've already seen ~17% gap between Meta's reported
 *    landing-page-views and our own variation_views.
 *  - CAPI fires from the Stripe webhook, which can't be blocked, so paid
 *    conversions get attributed even when the browser side fails.
 *
 * Dedup: we set `event_id` to the Stripe session id and the browser-side
 * Pixel sends the same id via `{eventID: ...}`. Meta dedupes events that
 * arrive on both paths inside a 7-day window.
 *
 * https://developers.facebook.com/docs/marketing-api/conversions-api
 */

const PIXEL_ID = "1308736174041664"; // matches META_PIXEL_ID in app/layout.tsx
const GRAPH_VERSION = "v22.0";

function sha256Lower(s: string): string {
  return createHash("sha256").update(s.trim().toLowerCase()).digest("hex");
}

/**
 * Pulls Meta's click-attribution cookies out of an HTTP request's Cookie
 * header. Every route that fires CAPI should call this and pass the result
 * through to sendCapiX — it ties server events back to the exact ad click
 * that brought the visitor in, instead of fuzzy email-hash matching.
 *
 * Both cookies are best-effort:
 *   _fbc is set by proxy.ts when ?fbclid=XXX is on a URL (or by Pixel JS).
 *   _fbp is set automatically by the Pixel JS on every browser session.
 */
export function readMetaCookies(
  cookieHeader: string | null | undefined,
): { fbc: string | null; fbp: string | null } {
  const cookies = cookieHeader ?? "";
  const fbc = cookies.match(/(?:^|;\s*)_fbc=([^;]+)/)?.[1] ?? null;
  const fbp = cookies.match(/(?:^|;\s*)_fbp=([^;]+)/)?.[1] ?? null;
  return { fbc, fbp };
}

export type CapiPurchase = {
  // ISO-8601 or seconds-since-epoch; we accept Date and convert.
  occurredAt: Date;
  // Stripe session id is perfect — unique, stable, present on both sides.
  eventId: string;
  // Identity signals. More we send, better the Match Quality score.
  email?: string | null;
  phone?: string | null;
  country?: string | null; // 2-letter ISO
  ip?: string | null;
  userAgent?: string | null;
  // The webhook is server-to-server, so it can't read user cookies. We
  // stash fbc/fbp in Stripe metadata at /api/checkout time and the
  // webhook reads them back from there.
  fbc?: string | null;
  fbp?: string | null;
  // Origin page (the user's final step). The browser side fired at
  // /reserved so we mirror that here.
  sourceUrl?: string;
  // Money + context.
  value: number; // major units (50, 249, 7500)
  currency: string; // ISO 4217 (usd, aud, jpy)
  mode: "deposit" | "purchase";
  variation: string | null;
};

export type CapiLead = {
  occurredAt: Date;
  // Client-generated UUID that the browser fbq Lead fire ALSO sends as
  // {eventID: ...}. Same id on both paths → Meta dedupes inside its 7-day
  // attribution window.
  eventId: string;
  email: string;
  phone?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  // Meta click-attribution cookies (read via readMetaCookies).
  fbc?: string | null;
  fbp?: string | null;
  sourceUrl?: string;
  // Where the lead came from on the page so Meta breakdowns work
  // ("hero", "pricing", "chat", ...) — surfaces in custom_data.source.
  source: string;
  variation: string | null;
  // Optional content_name lets you split waitlist vs. demo vs. anything else
  // in Meta reports. Defaults to "waitlist".
  contentName?: string;
};

export async function sendCapiLead(p: CapiLead): Promise<void> {
  const token = process.env.META_PIXEL_TOKEN ?? process.env.META_ADS_TOKEN;
  if (!token) {
    console.warn("[capi] no META_PIXEL_TOKEN / META_ADS_TOKEN — skipping lead");
    return;
  }
  if (!p.email) return; // a Lead without an email is meaningless to Meta

  const user_data: Record<string, unknown> = { em: [sha256Lower(p.email)] };
  if (p.phone) user_data.ph = [sha256Lower(p.phone.replace(/\D/g, ""))];
  if (p.ip) user_data.client_ip_address = p.ip;
  if (p.userAgent) user_data.client_user_agent = p.userAgent;
  if (p.fbc) user_data.fbc = p.fbc;
  if (p.fbp) user_data.fbp = p.fbp;

  const body = {
    data: [
      {
        event_name: "Lead",
        event_time: Math.floor(p.occurredAt.getTime() / 1000),
        event_id: p.eventId,
        action_source: "website",
        event_source_url: p.sourceUrl ?? "https://getbraintech.com/",
        user_data,
        custom_data: {
          content_name: p.contentName ?? "waitlist",
          source: p.source,
          variation: p.variation ?? "unknown",
        },
      },
    ],
    ...(process.env.META_CAPI_TEST_CODE
      ? { test_event_code: process.env.META_CAPI_TEST_CODE }
      : {}),
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const text = await res.text();
    if (!res.ok) {
      console.error("[capi] lead failed", res.status, text.slice(0, 500));
      return;
    }
    console.log("[capi] lead sent", {
      event_id: p.eventId,
      source: p.source,
      variation: p.variation,
      response: text.slice(0, 200),
    });
  } catch (err) {
    console.error("[capi] lead error", err);
  }
}

export type CapiCancel = {
  occurredAt: Date;
  eventId: string;
  email: string;
  ip?: string | null;
  userAgent?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  value: number; // major units of the unstarted purchase
  currency: string;
  mode: "deposit" | "purchase";
  variation: string | null;
};

/**
 * Custom event for cart-abandoned signals. Meta lets you build a custom
 * conversion off this event name in Events Manager — useful for
 * remarketing audiences ("clicked checkout, didn't buy in 7 days").
 */
export async function sendCapiCancel(p: CapiCancel): Promise<void> {
  const token = process.env.META_PIXEL_TOKEN ?? process.env.META_ADS_TOKEN;
  if (!token) return;
  if (!p.email) return;

  const user_data: Record<string, unknown> = { em: [sha256Lower(p.email)] };
  if (p.ip) user_data.client_ip_address = p.ip;
  if (p.userAgent) user_data.client_user_agent = p.userAgent;
  if (p.fbc) user_data.fbc = p.fbc;
  if (p.fbp) user_data.fbp = p.fbp;

  const body = {
    data: [
      {
        event_name: "CheckoutCancelled",
        event_time: Math.floor(p.occurredAt.getTime() / 1000),
        event_id: p.eventId,
        action_source: "website",
        event_source_url: "https://getbraintech.com/?reserve=cancelled",
        user_data,
        custom_data: {
          value: p.value,
          currency: p.currency.toUpperCase(),
          content_ids: [
            p.mode === "purchase" ? "founding-membership" : "deposit-spot",
          ],
          content_type: "product",
          mode: p.mode,
          variation: p.variation ?? "unknown",
        },
      },
    ],
    ...(process.env.META_CAPI_TEST_CODE
      ? { test_event_code: process.env.META_CAPI_TEST_CODE }
      : {}),
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const text = await res.text();
    if (!res.ok) {
      console.error("[capi] cancel failed", res.status, text.slice(0, 500));
      return;
    }
    console.log("[capi] cancel sent", {
      event_id: p.eventId,
      mode: p.mode,
      response: text.slice(0, 200),
    });
  } catch (err) {
    console.error("[capi] cancel error", err);
  }
}

export async function sendCapiPurchase(p: CapiPurchase): Promise<void> {
  const token = process.env.META_PIXEL_TOKEN ?? process.env.META_ADS_TOKEN;
  if (!token) {
    console.warn("[capi] no META_PIXEL_TOKEN / META_ADS_TOKEN — skipping");
    return;
  }

  // Hash anything that looks like PII before sending.
  const user_data: Record<string, unknown> = {};
  if (p.email) user_data.em = [sha256Lower(p.email)];
  if (p.phone) user_data.ph = [sha256Lower(p.phone.replace(/\D/g, ""))];
  if (p.country) user_data.country = [sha256Lower(p.country)];
  if (p.ip) user_data.client_ip_address = p.ip;
  if (p.userAgent) user_data.client_user_agent = p.userAgent;
  if (p.fbc) user_data.fbc = p.fbc;
  if (p.fbp) user_data.fbp = p.fbp;

  const body = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(p.occurredAt.getTime() / 1000),
        event_id: p.eventId,
        action_source: "website",
        event_source_url: p.sourceUrl ?? "https://getbraintech.com/reserved",
        user_data,
        custom_data: {
          value: p.value,
          currency: p.currency.toUpperCase(),
          content_ids: [
            p.mode === "purchase" ? "founding-membership" : "deposit-spot",
          ],
          content_type: "product",
          // Custom fields surface in Meta's "Custom Data" breakdown.
          mode: p.mode,
          variation: p.variation ?? "unknown",
        },
      },
    ],
    // test_event_code lets us see events in Events Manager → Test events.
    // Only set when explicitly enabled — leaving it on in prod makes Meta
    // ignore the events for attribution.
    ...(process.env.META_CAPI_TEST_CODE
      ? { test_event_code: process.env.META_CAPI_TEST_CODE }
      : {}),
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const text = await res.text();
    if (!res.ok) {
      console.error("[capi] purchase failed", res.status, text.slice(0, 500));
      return;
    }
    console.log("[capi] purchase sent", {
      event_id: p.eventId,
      value: p.value,
      currency: p.currency,
      response: text.slice(0, 200),
    });
  } catch (err) {
    console.error("[capi] purchase error", err);
  }
}
