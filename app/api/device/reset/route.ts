// Re-derive the device's desired state from active_rules and push it.
// Use case: the router got out of sync (somebody manually changed uci,
// firmware was reflashed, the device is fresh out of the box), or
// account_rules was edited directly. This is the canonical "make the
// router match what's stored in this account" button.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import {
  getSql,
  ensureDeviceSchema,
  ensureAccountSchema,
} from "@/app/lib/db";
import {
  assembleDesired,
  buildRuleOps,
  materializeOps,
  type AccountRule,
  type Op,
  type RuleType,
  type RuleParams,
} from "@/app/lib/rules";

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

export async function POST(req: Request) {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { device_id?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);

  const devs = (await sql`
    SELECT device_id, desired_version FROM devices
    WHERE owner_email = ${email}${body.device_id ? sql` AND device_id = ${body.device_id}` : sql``}
    ORDER BY created_at LIMIT 1;
  `) as { device_id: string; desired_version: number }[];
  const dev = devs[0];
  if (!dev) return NextResponse.json({ error: "no device" }, { status: 404 });

  const all = (await sql`
    SELECT rule_id, device_id, rule_type, params, ops, active, name, summary
    FROM account_rules WHERE owner_email = ${email} AND device_id = ${dev.device_id};
  `) as RuleRow[];
  // Reset always REGENERATES the ops from params via buildRuleOps for ACTIVE
  // rules. params is canonical; ops is derived. So a buildRuleOps fix (e.g.
  // adding AAAA blocks, or any future rule-template change) is picked up by
  // a simple `btnet reset` — no need to remove and re-add each rule.
  // Inactive rules keep their stored ops (they're never applied anyway —
  // only their cleanup ops run via ownedSections in assembleDesired).
  const allRules: AccountRule[] = await Promise.all(
    all.map(async (r) => {
      const base: AccountRule = {
        rule_id: r.rule_id,
        rule_type: r.rule_type,
        params: r.params,
        // Active rules get structural ops re-derived from params via
        // buildRuleOps; inactive ones keep whatever's stored (they only
        // contribute cleanup ops anyway).
        ops: r.active ? buildRuleOps(r.rule_id, r.rule_type, r.params) : r.ops,
        name: r.name,
        summary: r.summary ?? undefined,
        active: r.active,
      };
      if (r.active) base.ops = await materializeOps(base);
      return base;
    }),
  );
  // Persist structural ops for active rules so account_rules.ops stays in
  // sync with the latest buildRuleOps shape. For block_managed_list we
  // store the structural form (empty content) — materialization is fetched
  // fresh on every assembly anyway.
  for (const r of allRules) {
    if (!r.active) continue;
    const structural =
      r.rule_type === "block_managed_list" ? buildRuleOps(r.rule_id, r.rule_type, r.params) : r.ops;
    await sql`UPDATE account_rules SET ops = ${JSON.stringify(structural)}::jsonb, updated_at = NOW()
      WHERE rule_id = ${r.rule_id};`;
  }
  const desired = assembleDesired(allRules);
  const next = dev.desired_version + 1;
  await sql`
    UPDATE devices SET desired = ${JSON.stringify(desired)}::jsonb, desired_version = ${next}, updated_at = NOW()
    WHERE device_id = ${dev.device_id};
  `;
  return NextResponse.json({
    ok: true,
    device_id: dev.device_id,
    desired_version: next,
    active_rules: allRules.filter((r) => r.active).length,
    total_rules_ever: allRules.length,
    ops_regenerated: true,
  });
}
