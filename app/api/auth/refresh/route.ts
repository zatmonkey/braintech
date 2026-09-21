import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSession, refreshSession, sessionCookie } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Slide the bt_session cookie forward without a new OTP.
 *
 * Browser sessions are refreshed transparently by proxy.ts on page loads;
 * this endpoint exists for non-browser clients (the btnet CLI) that only
 * ever hit /api/* routes, which proxy doesn't cover. Idempotent: if the
 * token isn't due yet the existing cookie is left as-is.
 */
export async function POST() {
  const store = await cookies();
  const token = store.get(sessionCookie.name)?.value;
  const claims = readSession(token);
  if (!claims) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const refreshed = refreshSession(token);
  const res = NextResponse.json({
    ok: true,
    email: claims.email,
    refreshed: Boolean(refreshed),
    exp: refreshed ? (readSession(refreshed)?.exp ?? claims.exp) : claims.exp,
  });
  if (refreshed) {
    res.cookies.set(sessionCookie.name, refreshed, sessionCookie.options);
  }
  return res;
}
