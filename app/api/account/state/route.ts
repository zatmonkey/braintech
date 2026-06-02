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
import { loadMacGroups } from "@/app/lib/groups";

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

  // Bucket rules by the group they target (rule_type='pause_group' →
  // params.group_id). Other rule types are network-wide and rendered
  // separately in the dashboard.
  const rulesByGroup = new Map<string, RuleRow[]>();
  for (const r of rules) {
    if (!r.active) continue;
    if (r.rule_type === "pause_group") {
      const gid = (r.params as { group_id?: string }).group_id;
      if (!gid) continue;
      const list = rulesByGroup.get(gid) ?? [];
      list.push(r);
      rulesByGroup.set(gid, list);
    }
  }

  const sessionId = `acct:${email}`;
  const pending = (await sql`
    SELECT pending_proposal FROM chat_sessions WHERE session_id = ${sessionId};
  `) as { pending_proposal: unknown }[];

  const mem = (await sql`
    SELECT humans, notes, updated_at FROM account_memory WHERE owner_email = ${email};
  `) as { humans: unknown; notes: string; updated_at: string }[];

  return NextResponse.json({
    email,
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
        })),
      };
    }),
    rules,
    memory: mem[0] ?? { humans: [], notes: "", updated_at: null },
    pending_proposal: pending[0]?.pending_proposal ?? null,
  });
}
