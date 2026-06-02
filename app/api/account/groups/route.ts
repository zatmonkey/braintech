// Group CRUD: list & create. Per-group ops live at /api/account/groups/[id].
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import { getSql, ensureAccountSchema, ensureDefaultGroup } from "@/app/lib/db";
import { newGroupId } from "@/app/lib/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await ensureAccountSchema(sql);
  await ensureDefaultGroup(sql, email);

  const groups = (await sql`
    SELECT group_id, name, description, is_default, created_at
    FROM account_groups WHERE owner_email = ${email} ORDER BY is_default DESC, created_at;
  `) as { group_id: string; name: string; description: string | null; is_default: boolean; created_at: string }[];
  // Pull MACs from the junction; join client_labels for friendly names.
  const members = (await sql`
    SELECT cgm.group_id, cgm.mac, COALESCE(cl.name, cgm.mac) AS name
    FROM client_group_memberships cgm
    LEFT JOIN client_labels cl
      ON cl.owner_email = cgm.owner_email AND cl.mac = cgm.mac
    WHERE cgm.owner_email = ${email};
  `) as { group_id: string; mac: string; name: string }[];

  const byGroup = new Map<string, { mac: string; name: string }[]>();
  for (const m of members) {
    const list = byGroup.get(m.group_id) ?? [];
    list.push({ mac: m.mac, name: m.name });
    byGroup.set(m.group_id, list);
  }
  return NextResponse.json({
    groups: groups.map((g) => ({ ...g, members: byGroup.get(g.group_id) ?? [] })),
  });
}

export async function POST(req: Request) {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { name?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const name = (body.name ?? "").trim().slice(0, 64);
  const description = body.description ? body.description.trim().slice(0, 200) : null;
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await ensureAccountSchema(sql);

  const group_id = newGroupId();
  await sql`
    INSERT INTO account_groups (group_id, owner_email, name, description)
    VALUES (${group_id}, ${email}, ${name}, ${description});
  `;
  return NextResponse.json({ ok: true, group_id, name, description });
}
