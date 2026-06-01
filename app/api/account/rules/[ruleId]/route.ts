import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import {
  getSql,
  ensureDeviceSchema,
  ensureAccountSchema,
} from "@/app/lib/db";
import { assembleDesired, materializeOps, type AccountRule, type Op, type RuleType, type RuleParams } from "@/app/lib/rules";
import { loadGroupMacs } from "@/app/lib/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RuleRow = {
  rule_id: string;
  device_id: string;
  rule_type: RuleType;
  params: RuleParams;
  ops: Op[];
  active: boolean;
  name: string;
  summary: string | null;
};

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ ruleId: string }> },
) {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { ruleId } = await ctx.params;
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);

  const rows = (await sql`
    SELECT rule_id, device_id, rule_type, params, ops, active, name, summary
    FROM account_rules WHERE rule_id = ${ruleId} AND owner_email = ${email};
  `) as RuleRow[];
  const r = rows[0];
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });

  await sql`UPDATE account_rules SET active = FALSE, updated_at = NOW() WHERE rule_id = ${ruleId};`;

  // Rebuild desired from every rule we've ever issued (active or not).
  // Inactive ones contribute cleanup ops; active ones contribute cleanup + apply.
  const all = (await sql`
    SELECT rule_id, device_id, rule_type, params, ops, active, name, summary
    FROM account_rules WHERE owner_email = ${email} AND device_id = ${r.device_id};
  `) as RuleRow[];
  const groupMacs = await loadGroupMacs(sql, email);
  const allRules: AccountRule[] = await Promise.all(
    all.map(async (x) => {
      const base: AccountRule = {
        rule_id: x.rule_id,
        rule_type: x.rule_type,
        params: x.params,
        ops: x.ops,
        name: x.name,
        summary: x.summary ?? undefined,
        active: x.active,
      };
      if (x.active) base.ops = await materializeOps(base, { groupMacs });
      return base;
    }),
  );
  const desired = assembleDesired(allRules);

  const dev = (await sql`
    SELECT desired_version FROM devices WHERE device_id = ${r.device_id} AND owner_email = ${email};
  `) as { desired_version: number }[];
  const next = (dev[0]?.desired_version ?? 0) + 1;
  await sql`
    UPDATE devices SET desired = ${JSON.stringify(desired)}::jsonb, desired_version = ${next}, updated_at = NOW()
    WHERE device_id = ${r.device_id};
  `;
  return NextResponse.json({ ok: true });
}
