/**
 * Public read endpoint — no auth. Given a MAC, returns the active rules
 * affecting that device on whichever Braintech account owns it. Hit by
 * the /mine page after the on-device captive server redirects a kid's
 * browser here with their MAC.
 *
 * Privacy posture: this exposes "what's blocked for this MAC" — which is
 * exactly what we want a kid to see if they hit a blocked site. It does
 * NOT expose the parent's email, household memory, telemetry, or any
 * other identifying info. A leaked MAC URL leaks "this MAC is blocked
 * from YouTube" — meaningful but bounded.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getSql,
  ensureDeviceSchema,
  ensureAccountSchema,
} from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RuleRow = {
  rule_id: string;
  rule_type: string;
  name: string;
  summary: string | null;
  params: Record<string, unknown>;
  owner_email: string;
};

const GROUP_SCOPED = new Set(["pause_group", "block_brainrot_group"]);
const DEVICE_SCOPED = new Set(["pause_device"]);

export async function GET(req: NextRequest) {
  const macRaw = (req.nextUrl.searchParams.get("mac") ?? "").toLowerCase();
  if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(macRaw)) {
    return NextResponse.json({ ok: false, reason: "bad mac" }, { status: 400 });
  }
  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ ok: false, reason: "unavailable" }, { status: 503 });
  }
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);

  // Identify owner via client_last_seen (the per-MAC presence registry).
  // If the MAC isn't in any account's registry, we can't say anything.
  const owners = (await sql`
    SELECT owner_email, hostname, last_seen
    FROM client_last_seen
    WHERE mac = ${macRaw}
    ORDER BY last_seen DESC
    LIMIT 1;
  `) as { owner_email: string; hostname: string | null; last_seen: string }[];

  if (owners.length === 0) {
    return NextResponse.json({
      ok: false,
      reason: "device not recognised on any account",
    });
  }
  const owner = owners[0].owner_email;
  const lastSeen = owners[0].last_seen;
  const seenRecently =
    Date.now() - new Date(lastSeen).getTime() < 5 * 60 * 1000;

  // Friendly label + group memberships for this MAC on that owner's account.
  const labelRow = (await sql`
    SELECT name FROM client_labels
    WHERE owner_email = ${owner} AND mac = ${macRaw};
  `) as { name: string }[];
  const label = labelRow[0]?.name ?? null;

  const groupRows = (await sql`
    SELECT g.group_id, g.name
    FROM client_group_memberships m
    JOIN account_groups g
      ON g.group_id = m.group_id AND g.owner_email = m.owner_email
    WHERE m.owner_email = ${owner} AND m.mac = ${macRaw};
  `) as { group_id: string; name: string }[];
  const groupIds = new Set(groupRows.map((g) => g.group_id));
  const groupNameById = new Map(groupRows.map((g) => [g.group_id, g.name]));

  // Active rules on the owner's account. We filter to those that actually
  // affect THIS MAC:
  //   - device-scoped pause_device → target_mac == macRaw
  //   - group-scoped pause_group / block_brainrot_group → group_id in this MAC's groups
  //   - everything else (block_domains_network, force_router_dns,
  //     block_managed_list, block_ip_set) → whole-network, applies
  const allRules = (await sql`
    SELECT rule_id, rule_type, name, summary, params, owner_email
    FROM account_rules
    WHERE owner_email = ${owner} AND active = TRUE;
  `) as RuleRow[];

  const visible: Array<{
    rule_id: string;
    rule_type: string;
    name: string;
    summary: string | null;
    scope: "device" | "group" | "network";
    group_name?: string;
  }> = [];

  for (const r of allRules) {
    if (DEVICE_SCOPED.has(r.rule_type)) {
      const mac = String(r.params.mac ?? "").toLowerCase();
      if (mac === macRaw) {
        visible.push({
          rule_id: r.rule_id,
          rule_type: r.rule_type,
          name: r.name,
          summary: r.summary,
          scope: "device",
        });
      }
    } else if (GROUP_SCOPED.has(r.rule_type)) {
      const gid = String(r.params.group_id ?? "");
      if (groupIds.has(gid)) {
        visible.push({
          rule_id: r.rule_id,
          rule_type: r.rule_type,
          name: r.name,
          summary: r.summary,
          scope: "group",
          group_name: groupNameById.get(gid),
        });
      }
    } else {
      // Network-wide rules apply to every device on the LAN.
      visible.push({
        rule_id: r.rule_id,
        rule_type: r.rule_type,
        name: r.name,
        summary: r.summary,
        scope: "network",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    mac: macRaw,
    label,
    groups: groupRows,
    rules: visible,
    seen_recently: seenRecently,
  });
}
