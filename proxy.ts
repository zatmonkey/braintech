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
