// JSON view of the dashboard. Used by the `btnet` CLI to inspect devices,
// connected clients, labels, active rules, and any pending Bri proposal —
// the same data the dashboard page renders, but as JSON.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import {
  getSql,
  ensureDeviceSchema,
  ensureAccountSchema,
  ensureChatSchema,
  ensureDefaultGroup,
} from "@/app/lib/db";
import {
  loadMacGroups,
  loadBrainrotMinutes,
  loadTopAppsByMac,
  sumAppMinutes,
} from "@/app/lib/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Client = { hostname?: string; ip?: string; mac?: string; connected?: boolean };
type Telemetry = {
  firmware?: string;
  uptime_sec?: number;
  wan_up?: boolean;
  clients?: Client[];
};
type DeviceRow = {
  device_id: string;
  label: string | null;
  mac: string | null;
  desired_version: number;
  reported_version: number;
  last_seen: string | null;
  telemetry: Telemetry | null;
};
type RuleRow = {
  rule_id: string;
  device_id: string | null;
  name: string;
  rule_type: string;
  summary: string | null;
  params: Record<string, unknown>;
  ops: unknown;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export async function GET() {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);
  await ensureChatSchema(sql);
  await ensureDefaultGroup(sql, email);

  const devices = (await sql`
    SELECT device_id, label, mac, desired_version, reported_version, last_seen, telemetry
    FROM devices WHERE owner_email = ${email} ORDER BY created_at;
  `) as DeviceRow[];

  const labels = (await sql`
    SELECT mac, name FROM client_labels WHERE owner_email = ${email};
  `) as { mac: string; name: string }[];
  const macGroups = await loadMacGroups(sql, email);

  const groups = (await sql`
    SELECT group_id, name, description, is_default, created_at
    FROM account_groups WHERE owner_email = ${email}
    ORDER BY is_default DESC, created_at;
  `) as { group_id: string; name: string; description: string | null; is_default: boolean; created_at: string }[];

  const rules = (await sql`
    SELECT rule_id, device_id, name, rule_type, summary, params, ops, active, created_at, updated_at
    FROM account_rules WHERE owner_email = ${email} ORDER BY created_at;
  `) as RuleRow[];

  // Device sync drives the active/propagating/removing decision:
  //   - device synced + rule active  → "active"
  //   - device behind + rule active  → "propagating"  (in-flight add)
  //   - device behind + rule inactive recently
  //                                  → "removing"     (in-flight delete)
  //   - device synced + rule inactive→ tombstone, hide
  const primary = devices[0];
  const inSync = primary
    ? primary.desired_version === primary.reported_version
    : true;

  // Pull policy decisions reported by the agent on its last telemetry
  // tick. block_schedule_group rules attach these so the dashboard can
  // show "Allowing — 38/120 min today" or "Blocking — next opens Sat 14:00".
  type PolicyDecision = {
    rule_id: string;
    decision: "allow" | "enforce";
    evaluated_at: string;
    minutes_used_day: number;
    active_window?: {
      days: string[];
      start_min_of_day: number;
      end_min_of_day: number;
    };
    active_quota?: {
      period: string;
      minutes_used: number;
      minutes_max: number;
    };
    next_window_at?: string;
  };
  // Brain-credit balances per device. Cheap query, joined into the
  // device row payload so the dashboard can show "🧠 45 min" per MAC.
  const credits = (await sql`
    SELECT mac::text AS mac, balance_minutes
    FROM brain_credits WHERE owner_email = ${email};
  `) as { mac: string; balance_minutes: number }[];
  const creditBalanceByMac = new Map(
    credits.map((c) => [c.mac.toLowerCase(), Number(c.balance_minutes)]),
  );
  // Per-rule credits spent today (from spend_ack), so each schedule
  // rule card can say "+18 from credits today".
  const todaySpends = (await sql`
    SELECT rule_id, SUM(total_spent)::int AS minutes
    FROM brain_credit_spend_ack
    WHERE owner_email = ${email} AND day = CURRENT_DATE
    GROUP BY rule_id;
  `) as { rule_id: string; minutes: number }[];
  const creditsSpentByRule = new Map(
    todaySpends.map((t) => [t.rule_id, Number(t.minutes)]),
  );

  const telemetryAny = primary?.telemetry as { policy_status?: unknown } | null;
  const policyStatus: PolicyDecision[] = Array.isArray(telemetryAny?.policy_status)
    ? (telemetryAny!.policy_status as PolicyDecision[])
    : [];
  const policyByRule = new Map(policyStatus.map((d) => [d.rule_id, d] as const));
  // 5 minutes is a generous safety window — usually the agent picks up
  // a delete within 25s. The cap stops ancient deactivated rules from
  // resurfacing on the dashboard if someone leaves it open for days.
  const FIVE_MIN = 5 * 60 * 1000;
  function ruleStatus(r: RuleRow): "active" | "propagating" | "removing" | "hide" {
    if (r.active) return inSync ? "active" : "propagating";
    const updated = new Date(r.updated_at).getTime();
    if (!inSync && Date.now() - updated < FIVE_MIN) return "removing";
    return "hide";
  }

  // Bucket rules by the group they target. Group-scoped rule_types:
  // pause_group + block_brainrot_group. Network-wide types
  // (block_domains_network, force_router_dns, block_managed_list,
  // block_ip_set) don't bucket here — rendered elsewhere as house-wide.
  // We include "removing" rules so the parent sees the in-flight delete.
  const rulesByGroup = new Map<
    string,
    Array<RuleRow & { status: "active" | "propagating" | "removing" }>
  >();
  for (const r of rules) {
    if (
      r.rule_type !== "pause_group" &&
      r.rule_type !== "block_brainrot_group" &&
      r.rule_type !== "block_schedule_group"
    ) {
      continue;
    }
    const s = ruleStatus(r);
    if (s === "hide") continue;
    const gid = (r.params as { group_id?: string }).group_id;
    if (!gid) continue;
    const list = rulesByGroup.get(gid) ?? [];
    list.push({ ...r, status: s });
    rulesByGroup.set(gid, list);
  }

  const sessionId = `acct:${email}`;
  const pending = (await sql`
    SELECT pending_proposal FROM chat_sessions WHERE session_id = ${sessionId};
  `) as { pending_proposal: unknown }[];

  const mem = (await sql`
    SELECT humans, notes, updated_at FROM account_memory WHERE owner_email = ${email};
  `) as { humans: unknown; notes: string; updated_at: string }[];

  // Usage / brainrot — heavier queries, but lightweight enough to ship
  // alongside the state poll. The dashboard hits this endpoint every 5s
  // for rule status and every 60s for usage; we always recompute usage
  // here and let the client decide what to merge.
  const brainrotByMac = await loadBrainrotMinutes(sql, email);
  const appsByMac = await loadTopAppsByMac(sql, email);
  const macGroupsForUsage = macGroups;
  const usagePerMac = Object.fromEntries(
    [...brainrotByMac.entries()].map(([mac, minutes]) => [mac, minutes]),
  );
  const usagePerGroup: Record<string, number | null> = {};
  for (const g of groups) {
    const memberMacs = [...macGroupsForUsage.entries()]
      .filter(([, gids]) => gids.includes(g.group_id))
      .map(([m]) => m);
    const mins = memberMacs.map((m) => brainrotByMac.get(m) ?? null);
    if (mins.every((m) => m === null)) {
      usagePerGroup[g.group_id] = null;
    } else {
      let total = 0;
      for (const m of mins) total += m ?? 0;
      usagePerGroup[g.group_id] = total;
    }
  }
  const allMacs = [...appsByMac.keys()];
  let householdMinutes: number | null = null;
  if (allMacs.length > 0 && allMacs.some((m) => brainrotByMac.has(m))) {
    householdMinutes = 0;
    for (const m of allMacs) householdMinutes += brainrotByMac.get(m) ?? 0;
  }
  const householdApps = sumAppMinutes(...allMacs.map((m) => appsByMac.get(m) ?? []));
  const appsByMacObj = Object.fromEntries(appsByMac);

  return NextResponse.json({
    email,
    usage: {
      household_minutes: householdMinutes,
      household_apps: householdApps,
      per_mac_minutes: usagePerMac,
      per_group_minutes: usagePerGroup,
      per_mac_apps: appsByMacObj,
    },
    credit_balance_by_mac: Object.fromEntries(creditBalanceByMac),
    devices: devices.map((d) => ({
      device_id: d.device_id,
      label: d.label,
      mac: d.mac,
      desired_version: d.desired_version,
      reported_version: d.reported_version,
      in_sync: d.desired_version === d.reported_version,
      last_seen: d.last_seen,
      online: d.last_seen ? Date.now() - new Date(d.last_seen).getTime() < 120_000 : false,
      telemetry: d.telemetry,
      clients: (d.telemetry?.clients ?? []).filter((c) => c.ip && !c.ip.startsWith("fe80")),
    })),
    labels: labels.map((l) => ({
      mac: l.mac,
      name: l.name,
      group_ids: macGroups.get(l.mac.toLowerCase()) ?? [],
    })),
    groups: groups.map((g) => {
      const memberMacs = new Set<string>();
      for (const [mac, gids] of macGroups.entries()) {
        if (gids.includes(g.group_id)) memberMacs.add(mac);
      }
      const labelByMac = new Map(labels.map((l) => [l.mac.toLowerCase(), l.name]));
      return {
        ...g,
        members: [...memberMacs].map((mac) => ({ mac, name: labelByMac.get(mac) ?? mac })),
        rules: (rulesByGroup.get(g.group_id) ?? []).map((r) => ({
          rule_id: r.rule_id,
          rule_type: r.rule_type,
          name: r.name,
          summary: r.summary,
          status: r.status,
          // Live policy decision for schedule rules. undefined for
          // static block_brainrot_group / pause_group rules.
          policy: policyByRule.get(r.rule_id),
          credits_spent_today: creditsSpentByRule.get(r.rule_id) ?? 0,
        })),
      };
    }),
    rules,
    memory: mem[0] ?? { humans: [], notes: "", updated_at: null },
    pending_proposal: pending[0]?.pending_proposal ?? null,
  });
}
