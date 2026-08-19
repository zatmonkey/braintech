// Toggle a group's `controlled` flag and push a fresh desired state so the
// device's bt_controlled_macs set (and thus all DPI enforcement scope)
// updates within one sync. Body: { group_id, controlled: boolean }.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import { getSql, ensureDeviceSchema, ensureAccountSchema } from "@/app/lib/db";
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
import { loadControlledMacs } from "@/app/lib/controlled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RuleRow = {
  rule_id: string;
  rule_type: RuleType;
  params: RuleParams;
  ops: Op[];
  active: boolean;
  name: string;
  summary: string | null;
};

export async function POST(req: NextRequest) {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { group_id?: string; controlled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const group_id = String(body.group_id ?? "").trim();
  if (!/^grp_[a-f0-9]{6,}$/.test(group_id)) {
    return NextResponse.json({ error: "bad group_id" }, { status: 400 });
  }
  if (typeof body.controlled !== "boolean") {
    return NextResponse.json({ error: "controlled must be boolean" }, { status: 400 });
  }

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "db unavailable" }, { status: 503 });
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);

  const owned = (await sql`
    SELECT is_default FROM account_groups
    WHERE owner_email = ${email} AND group_id = ${group_id} LIMIT 1;
  `) as { is_default: boolean }[];
  if (owned.length === 0) {
    return NextResponse.json({ error: "not your group" }, { status: 404 });
  }
  // The default "All devices" group would sweep every adult in — refuse.
  if (owned[0].is_default && body.controlled) {
    return NextResponse.json(
      { error: "cannot mark the default 'All devices' group controlled — use a per-person group" },
      { status: 400 },
    );
  }

  await sql`
    UPDATE account_groups SET controlled = ${body.controlled}
    WHERE owner_email = ${email} AND group_id = ${group_id};
  `;

  // Rebuild + push desired so controlled-macs.json (and the nft set) tracks
  // the change immediately.
  const devs = (await sql`
    SELECT device_id, desired_version, iana_timezone, posix_timezone FROM devices
    WHERE owner_email = ${email} ORDER BY created_at LIMIT 1;
  `) as {
    device_id: string;
    desired_version: number;
    iana_timezone: string | null;
    posix_timezone: string | null;
  }[];
  const dev = devs[0];
  if (dev) {
    const all = (await sql`
      SELECT rule_id, rule_type, params, ops, active, name, summary
      FROM account_rules WHERE owner_email = ${email} AND device_id = ${dev.device_id};
    `) as RuleRow[];
    const groupMacs = await loadGroupMacs(sql, email);
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
    const controlledMacs = await loadControlledMacs(sql, email);
    const tz =
      dev.iana_timezone && dev.posix_timezone
        ? { iana: dev.iana_timezone, posix: dev.posix_timezone }
        : undefined;
    const desired = assembleDesired(allRules, { timezone: tz, controlledMacs });
    await sql`
      UPDATE devices SET desired = ${JSON.stringify(desired)}::jsonb,
        desired_version = ${dev.desired_version + 1}, updated_at = NOW()
      WHERE device_id = ${dev.device_id};
    `;
  }

  return NextResponse.json({ ok: true, group_id, controlled: body.controlled });
}
