import { createHmac, timingSafeEqual, randomInt } from "node:crypto";

const COOKIE = "bt_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  return process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me";
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

// Compact signed token: base64url(payload).base64url(hmac)
export function signSession(email: string): string {
  const payload = JSON.stringify({ email, exp: Date.now() + MAX_AGE * 1000 });
  const p = b64url(payload);
  const sig = createHmac("sha256", secret()).update(p).digest("base64url");
  return `${p}.${sig}`;
}

export function verifySession(token: string | undefined): string | null {
  if (!token) return null;
  const [p, sig] = token.split(".");
  if (!p || !sig) return null;
  const expected = createHmac("sha256", secret()).update(p).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { email, exp } = JSON.parse(Buffer.from(p, "base64url").toString());
    if (typeof email !== "string" || typeof exp !== "number" || Date.now() > exp) {
      return null;
    }
    return email.toLowerCase();
  } catch {
    return null;
  }
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
