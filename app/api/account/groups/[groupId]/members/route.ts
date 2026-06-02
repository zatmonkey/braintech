// Group membership CRUD. POST adds (mac) to (group_id); DELETE removes it.
// Many-to-many — a MAC can belong to several groups, so this is purely
// additive/subtractive, not replace-semantics.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import { getSql, ensureAccountSchema } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAC_RE = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;

async function authed(): Promise<string | null> {
  const store = await cookies();
  return verifySession(store.get(sessionCookie.name)?.value);
}

async function checkGroup(
  sql: ReturnType<typeof getSql>,
  email: string,
  groupId: string,
): Promise<boolean> {
  if (!sql) return false;
  const r = (await sql`
    SELECT 1 FROM account_groups WHERE group_id = ${groupId} AND owner_email = ${email};
  `) as unknown[];
  return r.length > 0;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ groupId: string }> },
) {
  const email = await authed();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { groupId } = await ctx.params;

  let body: { mac?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const mac = (body.mac ?? "").toLowerCase().trim();
  if (!MAC_RE.test(mac)) return NextResponse.json({ error: "valid mac required" }, { status: 400 });

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await ensureAccountSchema(sql);

  if (!(await checkGroup(sql, email, groupId))) {
    return NextResponse.json({ error: "group not found" }, { status: 404 });
  }
  await sql`
    INSERT INTO client_group_memberships (owner_email, mac, group_id)
    VALUES (${email}, ${mac}, ${groupId})
    ON CONFLICT DO NOTHING;
  `;
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ groupId: string }> },
) {
  const email = await authed();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { groupId } = await ctx.params;
  const url = new URL(req.url);
  const mac = (url.searchParams.get("mac") ?? "").toLowerCase().trim();
  if (!MAC_RE.test(mac)) return NextResponse.json({ error: "valid mac required" }, { status: 400 });

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await ensureAccountSchema(sql);

  await sql`
    DELETE FROM client_group_memberships
    WHERE owner_email = ${email} AND mac = ${mac} AND group_id = ${groupId};
  `;
  return NextResponse.json({ ok: true });
}
