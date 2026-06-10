import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import {
  getSql,
  ensureDeviceSchema,
  ensureChatSchema,
  ensureAccountSchema,
  ensureDefaultGroup,
} from "@/app/lib/db";
import { runAccountChatTurn, ACCOUNT_TOOLS } from "@/app/lib/conversation";
import {
  newRuleId,
  newGroupId,
  buildRuleOps,
  assembleDesired,
  materializeOps,
  fetchManagedListDomains,
  fetchIpSetEntries,
  MANAGED_LIST_SOURCES,
  IP_SET_SOURCES,
  type AccountRule,
  type Op,
  type RuleType,
  type RuleParams,
  type PauseDeviceParams,
  type PauseGroupParams,
  type BlockDomainsParams,
  type BlockManagedListParams,
  type BlockIpSetParams,
  type BlockBrainrotGroupParams,
  type BlockScheduleGroupParams,
  type TimeWindow,
  type QuotaWindow,
  type Weekday,
  hhmmToMinutes,
  type ManagedListSource,
  type IpSetSource,
} from "@/app/lib/rules";
import { loadGroupMacs } from "@/app/lib/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bri's apply path runs assembleDesired + materializeOps for every rule
// the household has, which can take several seconds on a cold Neon
// connection. The default 10s function timeout occasionally cuts off
// AFTER the DB commit lands but BEFORE the response reaches the browser
// — user sees "Sorry, try that again?" while the rule has actually
// applied. Giving the chat path real headroom.
export const maxDuration = 60;

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
  desired_version: number;
  reported_version: number;
  last_seen: string | null;
  telemetry: Telemetry | null;
};
type RuleRow = {
  rule_id: string;
  rule_type: RuleType;
  name: string;
  summary: string | null;
  params: RuleParams;
  ops: Op[];
  active: boolean;
};
type LabelRow = { mac: string; name: string; group_id: string | null };
type GroupRow = { group_id: string; name: string; description: string | null };
type Human = {
  name: string;
  role: "parent" | "child";
  age?: number;
  devices?: string[];
  notes?: string;
};
type Memory = { humans: Human[]; notes: string };
type PendingProposal = {
  rule_id: string;
  rule_type: RuleType;
  name: string;
  summary: string;
  params: RuleParams;
  ops: Op[];
};

function fmtUptime(s?: number): string {
  if (!s) return "unknown";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtHouseholdMemory(memory: Memory): string {
  const lines: string[] = ["HOUSEHOLD MEMORY (canonical — persists across sessions):"];
  if (memory.humans.length === 0) {
    lines.push("  Humans: (none recorded yet — ask the parent who lives here)");
  } else {
    lines.push("  Humans:");
    for (const h of memory.humans) {
      const meta = [h.role, h.age ? `${h.age}y` : null].filter(Boolean).join(", ");
      const devs = h.devices?.length ? ` — devices: ${h.devices.join(", ")}` : "";
      const note = h.notes ? ` (${h.notes})` : "";
      lines.push(`  - ${h.name} [${meta}]${devs}${note}`);
    }
  }
  if (memory.notes) lines.push(`  Notes: ${memory.notes}`);
  return lines.join("\n");
}

function fmtGroups(
  groups: GroupRow[],
  membership: Map<string, { mac: string; name: string }[]>,
): string {
  if (groups.length === 0) return "GROUPS: (none defined — Bri can create one with create_group)";
  const lines = ["GROUPS (named buckets of MACs that pause_group can target):"];
  for (const g of groups) {
    const members = membership.get(g.group_id) ?? [];
    const desc = g.description ? ` — ${g.description}` : "";
    lines.push(`  - ${g.group_id} "${g.name}"${desc} (${members.length} devices)`);
    for (const m of members) lines.push(`      • ${m.name} (${m.mac})`);
  }
  return lines.join("\n");
}

function buildContext(
  devices: DeviceRow[],
  labels: Map<string, string>,
  groups: GroupRow[],
  membership: Map<string, { mac: string; name: string }[]>,
  activeRules: RuleRow[],
  pending: PendingProposal | null,
  memory: Memory,
): string {
  const memSection = fmtHouseholdMemory(memory);
  const groupSection = fmtGroups(groups, membership);
  if (devices.length === 0) {
    return `${memSection}\n\nLIVE STATE: No Braintech device is linked to this account yet.`;
  }
  const sections: string[] = devices.map((d) => {
    const online = d.last_seen && Date.now() - new Date(d.last_seen).getTime() < 120_000;
    const t = d.telemetry ?? {};
    const clients = (t.clients ?? []).filter((c) => c.ip && !c.ip.startsWith("fe80"));
    const clientLines =
      clients.length === 0
        ? "- (none seen yet)"
        : clients
            .map((c) => {
              const friendly = (c.mac && labels.get(c.mac.toLowerCase())) || c.hostname || "unnamed";
              return `- ${friendly} (${c.ip}, ${c.mac})${c.connected ? "" : " [idle]"}`;
            })
            .join("\n");
    const rules =
      activeRules.length === 0
        ? "(none — the router has 0 rules right now. Any rule the parent references must be freshly proposed; do NOT say 'already blocked' / 'still in place' / 'already on' based on chat history alone.)"
        : activeRules
            .map(
              (r) =>
                `- ${r.name} [${r.rule_type}]${r.summary ? ` — ${r.summary}` : ""}`,
            )
            .join("\n");
    return [
      `LIVE STATE — ${d.label ?? "Braintech device"} (${online ? "ONLINE" : "OFFLINE"})`,
      `Firmware: ${t.firmware ?? "?"} | WAN: ${t.wan_up ? "up" : "down"} | Uptime: ${fmtUptime(t.uptime_sec)} | Config ${d.reported_version === d.desired_version ? "in sync" : "updating"}`,
      `Connected devices (${clients.length}):`,
      clientLines,
      `ACTIVE RULES (${activeRules.length}) — the ONLY rules currently on the router:`,
      rules,
    ].join("\n");
  });
  if (pending) {
    sections.push(
      [
        `PENDING PROPOSAL waiting for confirmation:`,
        `- ${pending.name} [${pending.rule_type}] — ${pending.summary}`,
        ``,
        `>>> If the parent's latest message is a confirmation (yes/yep/apply/do it/go/sure/ok/👍),`,
        `>>> call apply_pending_rule NOW. Do NOT call propose_rule again. Do NOT re-emit "Apply?".`,
      ].join("\n"),
    );
  }
  return [memSection, groupSection, ...sections].join("\n\n");
}

export async function POST(req: Request) {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const message = (body.message ?? "").trim().slice(0, 600);
  if (!message) return NextResponse.json({ error: "empty" }, { status: 400 });

  const sql = getSql();
  if (!sql) return NextResponse.json({ reply: "We're having a hiccup — try again shortly." });

  await ensureDeviceSchema(sql);
  await ensureChatSchema(sql);
  await ensureAccountSchema(sql);
  await ensureDefaultGroup(sql, email);

  const devices = (await sql`
    SELECT device_id, label, desired_version, reported_version, last_seen, telemetry
    FROM devices WHERE owner_email = ${email} ORDER BY created_at;
  `) as DeviceRow[];
  const primary = devices[0]; // v1: act on the first device

  const labelRows = (await sql`
    SELECT mac, name, group_id FROM client_labels WHERE owner_email = ${email};
  `) as LabelRow[];
  const labels = new Map(labelRows.map((l) => [l.mac.toLowerCase(), l.name]));

  const groupRows = (await sql`
    SELECT group_id, name, description
    FROM account_groups WHERE owner_email = ${email} ORDER BY created_at;
  `) as GroupRow[];

  // Membership lives in client_group_memberships (the many-to-many table),
  // NOT in client_labels.group_id (legacy single-group column kept around
  // for old code paths). We also reach into client_last_seen so each member
  // gets a real-looking name — manually-set label → DHCP hostname → MAC.
  // Without the hostname fallback, Bri sees a raw MAC and hallucinates
  // "I'll add ApeTop to the group" when ApeTop is already in it.
  const memberRows = (await sql`
    SELECT cgm.group_id, cgm.mac,
           cl.name AS label_name,
           cls.hostname AS hostname
    FROM client_group_memberships cgm
    LEFT JOIN client_labels cl
      ON cl.owner_email = cgm.owner_email AND cl.mac = cgm.mac
    LEFT JOIN client_last_seen cls
      ON cls.owner_email = cgm.owner_email AND cls.mac = cgm.mac
    WHERE cgm.owner_email = ${email};
  `) as {
    group_id: string;
    mac: string;
    label_name: string | null;
    hostname: string | null;
  }[];
  const membership = new Map<string, { mac: string; name: string }[]>();
  for (const r of memberRows) {
    const list = membership.get(r.group_id) ?? [];
    list.push({
      mac: r.mac,
      name: r.label_name ?? r.hostname ?? r.mac,
    });
    membership.set(r.group_id, list);
  }

  const ruleRows = (await sql`
    SELECT rule_id, rule_type, name, summary, params, ops, active
    FROM account_rules WHERE owner_email = ${email} ORDER BY created_at;
  `) as RuleRow[];
  const activeRules = ruleRows.filter((r) => r.active);

  const sessionId = `acct:${email}`;
  await sql`
    INSERT INTO chat_sessions (session_id, email) VALUES (${sessionId}, ${email})
    ON CONFLICT (session_id) DO UPDATE SET updated_at = NOW();
  `;
  const sessRows = (await sql`
    SELECT pending_proposal FROM chat_sessions WHERE session_id = ${sessionId};
  `) as { pending_proposal: PendingProposal | null }[];
  const pendingInitial = sessRows[0]?.pending_proposal ?? null;

  // Household memory — the canonical long-term state Bri reads & writes.
  // Chat history is conversational flow, NOT a state store; the memory blob is.
  const memRows = (await sql`
    SELECT humans, notes FROM account_memory WHERE owner_email = ${email};
  `) as { humans: Human[]; notes: string }[];
  const memory: Memory = {
    humans: memRows[0]?.humans ?? [],
    notes: memRows[0]?.notes ?? "",
  };

  await sql`INSERT INTO chat_messages (session_id, role, content) VALUES (${sessionId}, 'user', ${message});`;

  // No chat history. Every turn is stateless: CONTEXT (in system) +
  // LIVE STATE (in this turn) + the user's actual message. The two
  // things history WAS being kept for — multi-turn confirmation
  // ("yes") and clarifier follow-ups — both work without it:
  //   - "yes" + PENDING PROPOSAL in CONTEXT → apply_pending_rule.
  //   - A short clarifier reply that needs prior context to interpret
  //     is rare in practice; if it happens, Bri asks the parent to
  //     re-state the full request.
  // History anchoring was the source of "I apologise, I made a
  // mistake" preambles and "already blocked" hallucinations — and
  // both were costing apply turns where Bri talked instead of tool-
  // calling. Cleanest fix is to delete the rope.
  const context = buildContext(devices, labels, groupRows, membership, activeRules, pendingInitial, memory);

  const userTurn = [
    `>>> LIVE STATE (from the database this second — single source of truth, overrides anything you remember):`,
    context,
    ``,
    `>>> Parent just said:`,
    message,
  ].join("\n");
  const history: Anthropic.MessageParam[] = [
    { role: "user", content: userTurn },
  ];

  const onTool = async (name: string, input: unknown): Promise<string> => {
    try {
      const i = (input ?? {}) as Record<string, unknown>;
      if (name === "set_client_name") {
        const mac = String(i.mac ?? "").toLowerCase();
        const friendly = String(i.name ?? "").slice(0, 64);
        if (!mac || !friendly) return "error: mac and name required";
        await sql`
          INSERT INTO client_labels (owner_email, mac, name)
          VALUES (${email}, ${mac}, ${friendly})
          ON CONFLICT (owner_email, mac) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW();
        `;
        return `Saved "${friendly}" for ${mac}.`;
      }
      if (name === "propose_rule") {
        if (!primary) return "error: no device linked to this account yet";
        const rt = String(i.rule_type ?? "") as RuleType;
        const friendlyName = String(i.name ?? "").slice(0, 64) || "unnamed";
        const summary = String(i.summary ?? "").slice(0, 200);
        let params: RuleParams;
        let prefix: "pause" | "pausegrp" | "domains" | "dnsforce" | "mlist" | "ipset" | "brainrot" | "sched";
        if (rt === "pause_device") {
          const mac = String(i.target_mac ?? "").toLowerCase();
          if (!mac) return "error: target_mac required for pause_device";
          params = { mac, client_name: labels.get(mac) } as PauseDeviceParams;
          prefix = "pause";
        } else if (rt === "pause_group") {
          const gid = String(i.group_id ?? "");
          if (!gid) return "error: group_id required for pause_group";
          const g = (await sql`SELECT name FROM account_groups WHERE group_id = ${gid} AND owner_email = ${email};`) as { name: string }[];
          if (g.length === 0) return `error: group "${gid}" not found`;
          params = { group_id: gid, group_name: g[0].name } as PauseGroupParams;
          prefix = "pausegrp";
        } else if (rt === "block_brainrot_group") {
          const gid = String(i.group_id ?? "");
          if (!gid) return "error: group_id required for block_brainrot_group";
          const g = (await sql`SELECT name FROM account_groups WHERE group_id = ${gid} AND owner_email = ${email};`) as { name: string }[];
          if (g.length === 0) return `error: group "${gid}" not found`;
          const customDomains = Array.isArray(i.domains)
            ? (i.domains as string[]).map((d) => String(d).toLowerCase()).filter(Boolean)
            : undefined;
          params = {
            group_id: gid,
            group_name: g[0].name,
            ...(customDomains?.length ? { domains: customDomains } : {}),
          } as BlockBrainrotGroupParams;
          prefix = "brainrot";
        } else if (rt === "block_schedule_group") {
          const gid = String(i.group_id ?? "");
          if (!gid) return "error: group_id required for block_schedule_group";
          const g = (await sql`SELECT name FROM account_groups WHERE group_id = ${gid} AND owner_email = ${email};`) as { name: string }[];
          if (g.length === 0) return `error: group "${gid}" not found`;
          const appLabel = String(i.app_label ?? "").slice(0, 32) || "the app";
          // Parse allow_windows: convert HH:MM strings to minute-of-day
          // ints up front; surface bad input as a tool error rather than
          // shipping garbage to the agent.
          type RawWin = { days?: unknown; start_hhmm?: unknown; end_hhmm?: unknown };
          const winsIn = Array.isArray(i.allow_windows)
            ? (i.allow_windows as RawWin[])
            : [];
          const validDays = new Set(["mon","tue","wed","thu","fri","sat","sun"]);
          let parsedWindows: TimeWindow[];
          try {
            parsedWindows = winsIn.map((w) => {
              const ds = Array.isArray(w.days) ? (w.days as string[]).map((x) => String(x).toLowerCase()) : [];
              if (ds.length === 0 || !ds.every((d) => validDays.has(d))) {
                throw new Error(`bad days: ${JSON.stringify(w.days)}`);
              }
              return {
                days: ds as Weekday[],
                start_min_of_day: hhmmToMinutes(String(w.start_hhmm ?? "")),
                end_min_of_day: hhmmToMinutes(String(w.end_hhmm ?? "")),
              };
            });
          } catch (e) {
            return `error: bad allow_windows — ${(e as Error).message}`;
          }
          type RawQuota = { period?: unknown; minutes_max?: unknown };
          const quotasIn = Array.isArray(i.allow_quotas)
            ? (i.allow_quotas as RawQuota[])
            : [];
          const validPeriods = new Set(["day","week","weekend","weekday"]);
          const parsedQuotas: QuotaWindow[] = [];
          for (const q of quotasIn) {
            const p = String(q.period ?? "");
            const m = Number(q.minutes_max ?? 0);
            if (!validPeriods.has(p) || !(m > 0 && m < 10_000)) {
              return `error: bad allow_quota: ${JSON.stringify(q)}`;
            }
            parsedQuotas.push({
              period: p as "day"|"week"|"weekend"|"weekday",
              minutes_max: Math.floor(m),
            });
          }
          if (parsedWindows.length === 0 && parsedQuotas.length === 0) {
            return "error: block_schedule_group needs at least one allow_window or allow_quota — otherwise use block_brainrot_group";
          }
          const customDomains = Array.isArray(i.domains)
            ? (i.domains as string[]).map((d) => String(d).toLowerCase()).filter(Boolean)
            : undefined;
          params = {
            group_id: gid,
            group_name: g[0].name,
            app_label: appLabel,
            ...(customDomains?.length ? { domains: customDomains } : {}),
            allow_windows: parsedWindows,
            allow_quotas: parsedQuotas,
          } as BlockScheduleGroupParams;
          prefix = "sched";
        } else if (rt === "block_domains_network") {
          const ds = Array.isArray(i.domains) ? (i.domains as string[]).map((d) => String(d).toLowerCase()).filter(Boolean) : [];
          if (ds.length === 0) return "error: domains[] required for block_domains_network";
          params = { domains: ds } as BlockDomainsParams;
          prefix = "domains";
        } else if (rt === "force_router_dns") {
          params = {} as RuleParams;
          prefix = "dnsforce";
        } else if (rt === "block_managed_list") {
          const src = String(i.source ?? "hagezi-anti-bypass") as ManagedListSource;
          if (!(src in MANAGED_LIST_SOURCES)) return `error: unknown managed list source "${src}"`;
          // Do a fetch now so the propose-time count is accurate and any 4xx
          // surfaces here, not later when the parent is waiting on the apply.
          let count = 0;
          try {
            const domains = await fetchManagedListDomains(src);
            count = domains.length;
          } catch (e) {
            return `error: fetching ${src} failed — ${(e as Error).message}`;
          }
          params = {
            source: src,
            snapshot_at: new Date().toISOString(),
            domain_count: count,
          } as BlockManagedListParams;
          prefix = "mlist";
        } else if (rt === "block_ip_set") {
          const src = String(i.source ?? "") as IpSetSource;
          if (!(src in IP_SET_SOURCES)) return `error: unknown ip-set source "${src}"`;
          let count = 0;
          try {
            const ips = await fetchIpSetEntries(src);
            count = ips.length;
          } catch (e) {
            return `error: fetching ${src} failed — ${(e as Error).message}`;
          }
          const port = typeof i.dest_port === "number" ? (i.dest_port as number) : undefined;
          params = {
            source: src,
            snapshot_at: new Date().toISOString(),
            ip_count: count,
            ...(port != null ? { dest_port: port } : {}),
          } as BlockIpSetParams;
          prefix = "ipset";
        } else {
          return `error: unknown rule_type "${rt}"`;
        }
        const ruleId = newRuleId(prefix);
        const ops = buildRuleOps(ruleId, rt, params);
        const proposal: PendingProposal = { rule_id: ruleId, rule_type: rt, name: friendlyName, summary, params, ops };
        await sql`
          UPDATE chat_sessions SET pending_proposal = ${JSON.stringify(proposal)}::jsonb, updated_at = NOW()
          WHERE session_id = ${sessionId};
        `;
        return `Proposed rule "${friendlyName}". Awaiting parent confirmation.`;
      }
      if (name === "apply_pending_rule") {
        if (!primary) return "error: no device linked";
        const r = (await sql`SELECT pending_proposal FROM chat_sessions WHERE session_id = ${sessionId};`) as {
          pending_proposal: PendingProposal | null;
        }[];
        const p = r[0]?.pending_proposal;
        if (!p) return "error: no pending proposal to apply";
        // persist the new rule
        await sql`
          INSERT INTO account_rules (rule_id, owner_email, device_id, name, rule_type, summary, params, ops, active)
          VALUES (${p.rule_id}, ${email}, ${primary.device_id}, ${p.name}, ${p.rule_type}, ${p.summary}, ${JSON.stringify(p.params)}::jsonb, ${JSON.stringify(p.ops)}::jsonb, TRUE);
        `;
        // Rebuild desired from every rule we've ever issued (active or not).
        // Inactive ones contribute cleanup ops; active ones contribute apply too.
        // Active rule ops are MATERIALIZED fresh (block_managed_list pulls a
        // fresh upstream snapshot here so the latest list lands on the device).
        const allRows = (await sql`
          SELECT rule_id, rule_type, name, summary, params, ops, active
          FROM account_rules WHERE owner_email = ${email} AND device_id = ${primary.device_id};
        `) as RuleRow[];
        const groupMacs = await loadGroupMacs(sql, email);
        // Pre-fetch baseline minutes used today for each active schedule
        // rule, keyed by rule_id then MAC. Seeds the agent's on-device
        // quota counter so a "105 min/day" rule applied at 22:00 respects
        // minutes already burned earlier in the day.
        const scheduleBaselines = new Map<string, Record<string, number>>();
        for (const r of allRows) {
          if (r.rule_type !== "block_schedule_group" || !r.active) continue;
          const sp = r.params as BlockScheduleGroupParams;
          const macsForRule = groupMacs.get(sp.group_id) ?? [];
          if (macsForRule.length === 0) continue;
          const usage = (await sql`
            SELECT mac::text AS mac, COUNT(DISTINCT bucket_start)::int AS minutes
            FROM client_usage_minute
            WHERE owner_email = ${email}
              AND mac = ANY(${macsForRule}::text[])
              AND app = ${sp.app_label}
              AND bucket_start >= DATE_TRUNC('day', NOW())
            GROUP BY mac;
          `) as { mac: string; minutes: number }[];
          const perMac: Record<string, number> = {};
          for (const u of usage) {
            perMac[u.mac.toLowerCase()] = Number(u.minutes);
          }
          scheduleBaselines.set(r.rule_id, perMac);
        }
        const allRules: AccountRule[] = await Promise.all(
          allRows.map(async (r) => {
            const base: AccountRule = {
              rule_id: r.rule_id,
              rule_type: r.rule_type,
              params: r.params,
              ops: r.ops,
              name: r.name,
              summary: r.summary ?? undefined,
              active: r.active,
            };
            if (r.active) base.ops = await materializeOps(base, { groupMacs, scheduleBaselines });
            return base;
          }),
        );
        const desired = assembleDesired(allRules);
        const newVersion = primary.desired_version + 1;
        await sql`
          UPDATE devices SET desired = ${JSON.stringify(desired)}::jsonb, desired_version = ${newVersion}, updated_at = NOW()
          WHERE device_id = ${primary.device_id};
        `;
        await sql`UPDATE chat_sessions SET pending_proposal = NULL WHERE session_id = ${sessionId};`;
        return `Applied "${p.name}" — pushed to the device (will land within ~25s).`;
      }
      if (name === "cancel_pending_rule") {
        await sql`UPDATE chat_sessions SET pending_proposal = NULL WHERE session_id = ${sessionId};`;
        return "Pending proposal cancelled.";
      }
      if (name === "remove_rule") {
        if (!primary) return "error: no device linked";
        const ruleId = String(i.rule_id ?? "").trim();
        if (!ruleId) return "error: rule_id required";
        // Match against this owner only — never let Bri touch someone
        // else's rule from a hallucinated id.
        const found = (await sql`
          SELECT name FROM account_rules
          WHERE rule_id = ${ruleId} AND owner_email = ${email} AND active = TRUE;
        `) as { name: string }[];
        if (found.length === 0) {
          return `error: no active rule with id "${ruleId}" found for this account`;
        }
        const ruleName = found[0].name;
        // Soft-delete: keep the row as a tombstone so assembleDesired can
        // emit cleanup ops for the device on the next sync.
        await sql`
          UPDATE account_rules SET active = FALSE, updated_at = NOW()
          WHERE rule_id = ${ruleId} AND owner_email = ${email};
        `;
        // Rebuild desired from every rule we've ever issued. Same dance
        // as apply_pending_rule — the now-inactive rule contributes its
        // cleanup ops; remaining active rules still apply.
        const allRows = (await sql`
          SELECT rule_id, rule_type, name, summary, params, ops, active
          FROM account_rules WHERE owner_email = ${email} AND device_id = ${primary.device_id};
        `) as RuleRow[];
        const groupMacs = await loadGroupMacs(sql, email);
        const scheduleBaselines = new Map<string, Record<string, number>>();
        for (const r of allRows) {
          if (r.rule_type !== "block_schedule_group" || !r.active) continue;
          const sp = r.params as BlockScheduleGroupParams;
          const macsForRule = groupMacs.get(sp.group_id) ?? [];
          if (macsForRule.length === 0) continue;
          const usage = (await sql`
            SELECT mac::text AS mac, COUNT(DISTINCT bucket_start)::int AS minutes
            FROM client_usage_minute
            WHERE owner_email = ${email}
              AND mac = ANY(${macsForRule}::text[])
              AND app = ${sp.app_label}
              AND bucket_start >= DATE_TRUNC('day', NOW())
            GROUP BY mac;
          `) as { mac: string; minutes: number }[];
          const perMac: Record<string, number> = {};
          for (const u of usage) perMac[u.mac.toLowerCase()] = Number(u.minutes);
          scheduleBaselines.set(r.rule_id, perMac);
        }
        const allRules: AccountRule[] = await Promise.all(
          allRows.map(async (r) => {
            const base: AccountRule = {
              rule_id: r.rule_id,
              rule_type: r.rule_type,
              params: r.params,
              ops: r.ops,
              name: r.name,
              summary: r.summary ?? undefined,
              active: r.active,
            };
            if (r.active) base.ops = await materializeOps(base, { groupMacs, scheduleBaselines });
            return base;
          }),
        );
        const desired = assembleDesired(allRules);
        const newVersion = primary.desired_version + 1;
        await sql`
          UPDATE devices SET desired = ${JSON.stringify(desired)}::jsonb, desired_version = ${newVersion}, updated_at = NOW()
          WHERE device_id = ${primary.device_id};
        `;
        return `Removed "${ruleName}" — cleanup will land within ~25s.`;
      }
      if (name === "create_group") {
        const groupName = String(i.name ?? "").trim().slice(0, 64);
        if (!groupName) return "error: name required";
        const description = i.description ? String(i.description).slice(0, 200) : null;
        const gid = newGroupId();
        await sql`
          INSERT INTO account_groups (group_id, owner_email, name, description)
          VALUES (${gid}, ${email}, ${groupName}, ${description});
        `;
        return `Created group "${groupName}" (${gid}). Use set_device_group to add devices.`;
      }
      if (name === "add_device_to_group") {
        const mac = String(i.mac ?? "").toLowerCase();
        const gid = String(i.group_id ?? "");
        if (!mac || !gid) return "error: mac and group_id required";
        const g = (await sql`SELECT name FROM account_groups WHERE group_id = ${gid} AND owner_email = ${email};`) as { name: string }[];
        if (g.length === 0) return `error: group "${gid}" not found`;
        await sql`
          INSERT INTO client_group_memberships (owner_email, mac, group_id)
          VALUES (${email}, ${mac}, ${gid})
          ON CONFLICT DO NOTHING;
        `;
        return `Added ${mac} to "${g[0].name}".`;
      }
      if (name === "remove_device_from_group") {
        const mac = String(i.mac ?? "").toLowerCase();
        const gid = String(i.group_id ?? "");
        if (!mac || !gid) return "error: mac and group_id required";
        await sql`
          DELETE FROM client_group_memberships
          WHERE owner_email = ${email} AND mac = ${mac} AND group_id = ${gid};
        `;
        return `Removed ${mac} from group ${gid}.`;
      }
      if (name === "remember_household") {
        const next: Memory = { humans: memory.humans, notes: memory.notes };
        if (Array.isArray(i.humans)) {
          next.humans = (i.humans as Human[])
            .filter((h) => h && typeof h.name === "string" && (h.role === "parent" || h.role === "child"))
            .slice(0, 20)
            .map((h) => ({
              name: String(h.name).slice(0, 64),
              role: h.role,
              ...(typeof h.age === "number" ? { age: h.age } : {}),
              ...(Array.isArray(h.devices) ? { devices: h.devices.map((d) => String(d).toLowerCase()).slice(0, 10) } : {}),
              ...(h.notes ? { notes: String(h.notes).slice(0, 200) } : {}),
            }));
        }
        if (typeof i.notes === "string") next.notes = i.notes.slice(0, 800);
        await sql`
          INSERT INTO account_memory (owner_email, humans, notes)
          VALUES (${email}, ${JSON.stringify(next.humans)}::jsonb, ${next.notes})
          ON CONFLICT (owner_email) DO UPDATE SET
            humans = EXCLUDED.humans,
            notes = EXCLUDED.notes,
            updated_at = NOW();
        `;
        memory.humans = next.humans;
        memory.notes = next.notes;
        return `Household memory updated (${next.humans.length} humans, ${next.notes.length} notes chars).`;
      }
      return `error: unknown tool "${name}"`;
    } catch (err) {
      console.error("[account-chat] tool error", name, err);
      return `error: ${(err as Error).message}`;
    }
  };

  const { reply } = await runAccountChatTurn({
    history,
    context,
    tools: ACCOUNT_TOOLS,
    onTool,
  });

  await sql`INSERT INTO chat_messages (session_id, role, content) VALUES (${sessionId}, 'assistant', ${reply});`;
  return NextResponse.json({ reply });
}
