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
  const allPauseIds = all.filter((r) => r.rule_type === "pause_device").map((r) => r.rule_id);
  // Reset always REGENERATES the ops from params via buildRuleOps. params is
  // the canonical data; ops is derived. This way `reset` is also the natural
  // "re-bake stored rules with the current rule templates" knob — if we ship
  // a buildRuleOps fix (e.g. adding AAAA blocks), reset picks it up.
  const active: AccountRule[] = all
    .filter((r) => r.active)
    .map((r) => ({
      rule_id: r.rule_id,
      rule_type: r.rule_type,
      params: r.params,
      ops: buildRuleOps(r.rule_id, r.rule_type, r.params),
      name: r.name,
      summary: r.summary ?? undefined,
      active: true,
    }));
  // Persist the regenerated ops so account_rules.ops matches what the device
  // is actually running (otherwise the dashboard / next apply would diverge).
  for (const r of active) {
    await sql`UPDATE account_rules SET ops = ${JSON.stringify(r.ops)}::jsonb, updated_at = NOW()
      WHERE rule_id = ${r.rule_id};`;
  }
  const desired = assembleDesired(allPauseIds, active);
  const next = dev.desired_version + 1;
  await sql`
    UPDATE devices SET desired = ${JSON.stringify(desired)}::jsonb, desired_version = ${next}, updated_at = NOW()
    WHERE device_id = ${dev.device_id};
  `;
  return NextResponse.json({
    ok: true,
    device_id: dev.device_id,
    desired_version: next,
    active_rules: active.length,
    pause_rule_ids_cleaned: allPauseIds.length,
    ops_regenerated: true,
  });
}
