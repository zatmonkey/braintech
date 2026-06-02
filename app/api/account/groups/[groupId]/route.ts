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

  // Guard: refuse to delete the default group — there should always be one.
  const g = (await sql`SELECT is_default FROM account_groups WHERE group_id = ${groupId} AND owner_email = ${email};`) as { is_default: boolean }[];
  if (g.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (g[0].is_default) return NextResponse.json({ error: "cannot delete the default group" }, { status: 400 });

  await sql`DELETE FROM client_group_memberships WHERE group_id = ${groupId} AND owner_email = ${email};`;
  await sql`UPDATE client_labels SET group_id = NULL WHERE group_id = ${groupId} AND owner_email = ${email};`;
  await sql`DELETE FROM account_groups WHERE group_id = ${groupId} AND owner_email = ${email};`;
  return NextResponse.json({ ok: true });
}
