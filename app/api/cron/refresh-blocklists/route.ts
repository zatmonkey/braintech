// Daily refresh of upstream blocklists. Re-materializes desired state for
// every device that has at least one active block_managed_list or
// block_ip_set rule, so the device pulls fresh hagezi / dibdot / Tor data
// on its next sync.
//
// Triggered by Vercel cron (see vercel.json crons). Vercel signs cron
// invocations with the CRON_SECRET env var in the Authorization header.
// Manual hits without that header are rejected.
import { NextResponse } from "next/server";
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
import { loadGroupMacs } from "@/app/lib/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// generous: 30k IPs × 2 lists + 17k domains × per device, fetches are sequential
export const maxDuration = 300;

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

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = req.headers.get("authorization") ?? "";
  return got === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "no db" }, { status: 503 });
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);

  // Find every device with at least one active rule whose ops are
  // upstream-fetched. Anything else doesn't need a refresh.
  const devices = (await sql`
    SELECT DISTINCT d.device_id, d.desired_version, d.owner_email
    FROM devices d
    JOIN account_rules r ON r.device_id = d.device_id
    WHERE r.active = TRUE
      AND r.rule_type IN ('block_managed_list','block_ip_set');
  `) as { device_id: string; desired_version: number; owner_email: string }[];

  const refreshed: { device_id: string; version: number; rules: number }[] = [];
  const failures: { device_id: string; error: string }[] = [];

  for (const dev of devices) {
    try {
      const all = (await sql`
        SELECT rule_id, device_id, rule_type, params, ops, active, name, summary
        FROM account_rules WHERE device_id = ${dev.device_id};
      `) as RuleRow[];
      const groupMacs = await loadGroupMacs(sql, dev.owner_email);
      const allRules: AccountRule[] = await Promise.all(
        all.map(async (r) => {
          const base: AccountRule = {
            rule_id: r.rule_id,
            rule_type: r.rule_type,
            params: r.params,
            ops: r.active ? buildRuleOps(r.rule_id, r.rule_type, r.params) : r.ops,
            name: r.name,
            summary: r.summary ?? undefined,
            active: r.active,
          };
          if (r.active) base.ops = await materializeOps(base, { groupMacs });
          return base;
        }),
      );
      const desired = assembleDesired(allRules);
      const next = dev.desired_version + 1;
      await sql`
        UPDATE devices SET desired = ${JSON.stringify(desired)}::jsonb,
          desired_version = ${next}, updated_at = NOW()
        WHERE device_id = ${dev.device_id};
      `;
      refreshed.push({
        device_id: dev.device_id,
        version: next,
        rules: allRules.filter((r) => r.active).length,
      });
    } catch (e) {
      console.error("[cron/refresh] failed for", dev.device_id, e);
      failures.push({ device_id: dev.device_id, error: (e as Error).message });
    }
  }

  return NextResponse.json({
    ok: failures.length === 0,
    refreshed,
    failures,
    refreshed_at: new Date().toISOString(),
  });
}
