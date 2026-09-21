import { createHmac, timingSafeEqual, randomInt } from "node:crypto";

const COOKIE = "bt_session";

// Sliding session. Each token carries its own expiry, and any authed page
// load (proxy.ts) or `POST /api/auth/refresh` re-issues it with a fresh
// window — so an account that's used at least once every MAX_AGE never has
// to log in again. ABSOLUTE_MAX caps how long a chain of refreshes can run
// from the original OTP login, so a leaked cookie can't be kept alive
// forever. REFRESH_AFTER throttles re-issuing to at most once a day.
const MAX_AGE = 60 * 60 * 24 * 90; // 90-day sliding window
const ABSOLUTE_MAX_MS = 1000 * 60 * 60 * 24 * 365; // 1 year from original login
const REFRESH_AFTER_MS = 1000 * 60 * 60 * 24; // re-issue at most once a day
// Tokens minted before `iat`/`orig` existed were fixed 30-day tokens; we
// infer their issue time from exp so the absolute cap still applies.
const LEGACY_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

export type SessionClaims = {
  email: string;
  /** issued-at (ms) of this particular token */
  iat: number;
  /** expiry (ms) */
  exp: number;
  /** issued-at (ms) of the original OTP login this token descends from */
  orig: number;
};

// Hard-coded admin allowlist. These emails get access to /app/calendar
// and any other admin-only surface. Source from env if it ever needs to
// grow beyond one founder.
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? "alex@ksso.net")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.has(email.toLowerCase());
}

function secret(): string {
  return process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me";
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

// Compact signed token: base64url(payload).base64url(hmac)
// `orig` defaults to now (a fresh OTP login). Refreshes pass the original
// login time through so the absolute cap is measured from the real login.
export function signSession(email: string, orig: number = Date.now()): string {
  const now = Date.now();
  const exp = Math.min(now + MAX_AGE * 1000, orig + ABSOLUTE_MAX_MS);
  const payload = JSON.stringify({ email, iat: now, exp, orig });
  const p = b64url(payload);
  const sig = createHmac("sha256", secret()).update(p).digest("base64url");
  return `${p}.${sig}`;
}

// Verify signature + expiry and return the decoded claims, or null.
export function readSession(token: string | undefined): SessionClaims | null {
  if (!token) return null;
  const [p, sig] = token.split(".");
  if (!p || !sig) return null;
  const expected = createHmac("sha256", secret()).update(p).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { email, exp, iat, orig } = JSON.parse(Buffer.from(p, "base64url").toString());
    if (typeof email !== "string" || typeof exp !== "number" || Date.now() > exp) {
      return null;
    }
    const iatMs = typeof iat === "number" ? iat : exp - LEGACY_MAX_AGE_MS;
    const origMs = typeof orig === "number" ? orig : iatMs;
    return { email: email.toLowerCase(), iat: iatMs, exp, orig: origMs };
  } catch {
    return null;
  }
}

export function verifySession(token: string | undefined): string | null {
  return readSession(token)?.email ?? null;
}

/**
 * Sliding refresh. Returns a freshly signed token when the presented one is
 * valid and due for renewal (older than REFRESH_AFTER and still inside the
 * absolute cap), otherwise null — meaning "leave the cookie alone".
 * Never returns a token whose expiry would be earlier than the current one.
 */
export function refreshSession(token: string | undefined): string | null {
  const claims = readSession(token);
  if (!claims) return null;
  const now = Date.now();
  if (now - claims.iat < REFRESH_AFTER_MS) return null;
  const capped = claims.orig + ABSOLUTE_MAX_MS;
  if (now >= capped) return null;
  const newExp = Math.min(now + MAX_AGE * 1000, capped);
  if (newExp <= claims.exp) return null;
  return signSession(claims.email, claims.orig);
}

export const sessionCookie = {
  name: COOKIE,
  maxAge: MAX_AGE,
  options: {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE,
  },
};

export function newOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(email: string, code: string): string {
  // bind the code to the email so a code can't be replayed for another address
  return createHmac("sha256", secret()).update(`${email.toLowerCase()}:${code}`).digest("hex");
}
