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

  let body: { mac?: string; name?: string; group_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const mac = (body.mac ?? "").toLowerCase().trim();
  if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac)) {
    return NextResponse.json({ error: "valid mac required" }, { status: 400 });
  }
  // Either name or group_id (or both) must be provided. group_id=null
  // explicitly unassigns from a group.
  const hasName = typeof body.name === "string" && body.name.trim().length > 0;
  const hasGroup = "group_id" in body;
  if (!hasName && !hasGroup) {
    return NextResponse.json({ error: "name or group_id required" }, { status: 400 });
  }

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await ensureAccountSchema(sql);

  // If a group_id is provided (non-null), verify it belongs to this owner.
  const groupId = hasGroup ? (body.group_id === null ? null : String(body.group_id)) : undefined;
  if (groupId) {
    const g = (await sql`SELECT 1 FROM account_groups WHERE group_id = ${groupId} AND owner_email = ${email};`) as unknown[];
    if (g.length === 0) return NextResponse.json({ error: "group not found" }, { status: 400 });
  }

  if (hasName && hasGroup) {
    const name = body.name!.trim().slice(0, 64);
    await sql`
      INSERT INTO client_labels (owner_email, mac, name, group_id)
      VALUES (${email}, ${mac}, ${name}, ${groupId})
      ON CONFLICT (owner_email, mac) DO UPDATE SET
        name = EXCLUDED.name, group_id = EXCLUDED.group_id, updated_at = NOW();
    `;
  } else if (hasName) {
    const name = body.name!.trim().slice(0, 64);
    await sql`
      INSERT INTO client_labels (owner_email, mac, name)
      VALUES (${email}, ${mac}, ${name})
      ON CONFLICT (owner_email, mac) DO UPDATE SET
        name = EXCLUDED.name, updated_at = NOW();
    `;
  } else {
    // group_id only — upsert with a fallback name = mac if the row's brand new
    await sql`
      INSERT INTO client_labels (owner_email, mac, name, group_id)
      VALUES (${email}, ${mac}, ${mac}, ${groupId})
      ON CONFLICT (owner_email, mac) DO UPDATE SET
        group_id = EXCLUDED.group_id, updated_at = NOW();
    `;
  }
  return NextResponse.json({ ok: true });
}
