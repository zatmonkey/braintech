import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Sticky A/B rotation across landing-page variations.
 *
 * Behaviour on every request to `/`:
 *   - If the URL has `?variation=N` (0–5), use that and pin it as the cookie.
 *     This is how paid-ad URLs lock a specific variation per campaign.
 *   - Else if the `bt_var` cookie already exists with a valid index, leave it
 *     alone — a returning visitor sees the same variation as before (clean
 *     A/B; we'd contaminate the experiment otherwise).
 *   - Else pick a random variation 0..N-1, set the cookie, and let it render.
 *
 * The cookie is plain (no signing) — it's a UX rotation key, not a security
 * boundary. 30-day TTL: long enough that a revisit within a campaign window
 * sees the same hero, short enough that we eventually re-roll a stale visitor.
 *
 * Anything that's NOT the landing page (api routes, static assets, the
 * authed /app dashboard, etc.) is excluded via `config.matcher`.
 */

const TOTAL_VARIATIONS = 7; // keep in sync with app/variations.ts
const COOKIE_NAME = "bt_var";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
// The variation that mirrors the live IG ad copy verbatim. Paid Meta
// traffic (detected via ?fbclid=) gets pinned here so they don't fall
// into the 1/N message-match lottery. Update when the ad creative changes.
const PAID_META_VARIATION = "5";

function isValidIndex(v: string | undefined | null): boolean {
  if (v === undefined || v === null || v === "") return false;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < TOTAL_VARIATIONS;
}

function pickRandom(): string {
  // Math.random is fine here — this is a load-distribution decision, not a
  // crypto-grade one. We don't care that a deterministic adversary could
  // bias the bucket they land in.
  return String(Math.floor(Math.random() * TOTAL_VARIATIONS));
}

export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const queryOverride = url.searchParams.get("variation");
  const existingCookie = request.cookies.get(COOKIE_NAME)?.value;

  // fbclid is appended to every link clicked from Facebook/Instagram (paid
  // or organic). Used here ONLY as a hint that "this visitor came from
  // Meta" so we can pin them to the ad-mirror variation instead of the
  // random-rotation lottery (only ~1/N visitors otherwise see copy that
  // matches the ad they just clicked).
  const fromMeta = url.searchParams.has("fbclid");

  let chosen: string;
  let mustSet = false;

  if (isValidIndex(queryOverride)) {
    // Explicit ?variation=N wins. Always re-pin the cookie so subsequent
    // visits from the same campaign URL stay consistent.
    chosen = String(Number(queryOverride));
    if (existingCookie !== chosen) mustSet = true;
  } else if (isValidIndex(existingCookie)) {
    // Returning visitor — keep them on the same variation.
    chosen = existingCookie as string;
  } else if (fromMeta) {
    // First visit via a Meta click and no explicit override → ad-mirror.
    chosen = PAID_META_VARIATION;
    mustSet = true;
  } else {
    chosen = pickRandom();
    mustSet = true;
  }

  const response = NextResponse.next();

  if (mustSet) {
    response.cookies.set({
      name: COOKIE_NAME,
      value: chosen,
      path: "/",
      maxAge: COOKIE_MAX_AGE,
      sameSite: "lax",
      // Not httpOnly — the client-side tracker reads it to fire the view
      // beacon. The cookie carries no PII or auth.
      httpOnly: false,
      secure: true,
    });
  }

  // Stash the visitor's IP-country in a cookie so /api/checkout (and any
  // other downstream route that doesn't see geo headers cleanly) can
  // attribute pricing without re-running geo lookup. Re-stamped each
  // request — cheap and keeps a moving visitor on the right currency.
  // ?country=AU lets us preview localized pricing without changing IP.
  const queryCountry = url.searchParams.get("country");
  const country = (
    queryCountry ??
    request.headers.get("x-vercel-ip-country") ??
    ""
  ).toUpperCase();
  if (/^[A-Z]{2}$/.test(country)) {
    response.cookies.set({
      name: "bt_geo",
      value: country,
      path: "/",
      maxAge: COOKIE_MAX_AGE,
      sameSite: "lax",
      httpOnly: false,
      secure: true,
    });
  }

  // Meta click-attribution cookie. When a visitor arrives from a Facebook
  // or Instagram ad, the URL has `?fbclid=XXX`. We persist that as the
  // _fbc cookie in Meta's canonical format (fb.<subdomain>.<ts>.<fbclid>)
  // so every server-side Conversions API call from /api/waitlist,
  // /api/chat, /api/checkout(/cancel), and the Stripe webhook can include
  // it in user_data. Significantly improves Event Match Quality for paid
  // traffic — server events tie back to the exact ad click that drove
  // them, instead of fuzzy email-hash matching.
  // The Pixel JS on the page would set this too — but proxy runs before
  // JS so we don't miss the first events, and we only set if the cookie
  // isn't already present so we don't race the Pixel's clock.
  const fbclid = url.searchParams.get("fbclid");
  const existingFbc = request.cookies.get("_fbc")?.value;
  if (fbclid && !existingFbc) {
    // Meta format: fb.<subdomain-index>.<millis>.<fbclid>
    // subdomain-index = 1 means top-level domain (getbraintech.com).
    // millis is the click timestamp — we use server time as a proxy since
    // the click time isn't carried in the URL.
    // Date.now() is unavailable inside Workflow scripts but proxy runs
    // in the Edge/Node runtime, where it works normally.
    const fbcValue = `fb.1.${Date.now()}.${fbclid}`;
    response.cookies.set({
      name: "_fbc",
      value: fbcValue,
      path: "/",
      // Meta's recommended TTL is 90 days.
      maxAge: 60 * 60 * 24 * 90,
      sameSite: "lax",
      httpOnly: false,
      secure: true,
    });
  }

  return response;
}

export const config = {
  // Only run on the landing page itself. Exclude API routes, _next assets,
  // static files, favicon — they don't render variations and we don't want
  // proxy overhead on every API call.
  matcher: [
    {
      source:
        "/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|webp|svg|gif|ico|css|js|woff|woff2|ttf)$).*)",
    },
  ],
};
