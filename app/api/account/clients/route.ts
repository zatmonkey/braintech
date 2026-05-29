import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import { getSql, ensureAccountSchema } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { mac?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const mac = (body.mac ?? "").toLowerCase().trim();
  const name = (body.name ?? "").trim().slice(0, 64);
  if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac) || !name) {
    return NextResponse.json({ error: "mac and name required" }, { status: 400 });
  }

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await ensureAccountSchema(sql);

  await sql`
    INSERT INTO client_labels (owner_email, mac, name)
    VALUES (${email}, ${mac}, ${name})
    ON CONFLICT (owner_email, mac) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW();
  `;
  return NextResponse.json({ ok: true });
}
