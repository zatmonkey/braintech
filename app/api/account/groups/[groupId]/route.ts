// DELETE a group. Unassigns its members (client_labels.group_id → NULL).
// Any pause_group rule targeting it will materialize to an empty MAC set on
// the next reset — i.e. become a no-op until either the rule is removed or
// the group is recreated and re-populated.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import { getSql, ensureAccountSchema } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ groupId: string }> },
) {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { groupId } = await ctx.params;
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await ensureAccountSchema(sql);

  await sql`UPDATE client_labels SET group_id = NULL WHERE group_id = ${groupId} AND owner_email = ${email};`;
  const r = (await sql`DELETE FROM account_groups WHERE group_id = ${groupId} AND owner_email = ${email} RETURNING group_id;`) as { group_id: string }[];
  if (r.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
