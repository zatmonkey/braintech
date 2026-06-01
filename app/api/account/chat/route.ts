import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import {
  getSql,
  ensureDeviceSchema,
  ensureChatSchema,
  ensureAccountSchema,
} from "@/app/lib/db";
import { runAccountChatTurn, ACCOUNT_TOOLS } from "@/app/lib/conversation";
import {
  newRuleId,
  buildRuleOps,
  assembleDesired,
  materializeOps,
  fetchManagedListDomains,
  MANAGED_LIST_SOURCES,
  type AccountRule,
  type Op,
  type RuleType,
  type RuleParams,
  type PauseDeviceParams,
  type BlockDomainsParams,
  type BlockManagedListParams,
  type ManagedListSource,
} from "@/app/lib/rules";

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
type LabelRow = { mac: string; name: string };
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

function buildContext(
  devices: DeviceRow[],
  labels: Map<string, string>,
  activeRules: RuleRow[],
  pending: PendingProposal | null,
  memory: Memory,
): string {
  const memSection = fmtHouseholdMemory(memory);
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
        ? "none yet"
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
      `PENDING PROPOSAL waiting for confirmation:\n- ${pending.name} [${pending.rule_type}] — ${pending.summary}`,
    );
  }
  return [memSection, ...sections].join("\n\n");
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

  const devices = (await sql`
    SELECT device_id, label, desired_version, reported_version, last_seen, telemetry
    FROM devices WHERE owner_email = ${email} ORDER BY created_at;
  `) as DeviceRow[];
  const primary = devices[0]; // v1: act on the first device

  const labelRows = (await sql`
    SELECT mac, name FROM client_labels WHERE owner_email = ${email};
  `) as LabelRow[];
  const labels = new Map(labelRows.map((l) => [l.mac.toLowerCase(), l.name]));

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

  // Keep history short (last 2 exchanges = 4 messages). The transcript is
  // for conversational flow only — durable state lives in CONTEXT. The
  // shorter the history, the less room there is for Bri to anchor on her
  // own past "Done" claims and contradict the freshly-fetched CONTEXT.
  const histRows = (await sql`
    SELECT role, content FROM chat_messages WHERE session_id = ${sessionId}
    ORDER BY created_at DESC, id DESC LIMIT 4;
  `) as { role: string; content: string }[];
  const history: Anthropic.MessageParam[] = histRows
    .reverse()
    .map((r) => ({ role: r.role === "user" ? "user" : "assistant", content: r.content }));

  const context = buildContext(devices, labels, activeRules, pendingInitial, memory);

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
        let prefix: "pause" | "domains" | "dnsforce" | "mlist";
        if (rt === "pause_device") {
          const mac = String(i.target_mac ?? "").toLowerCase();
          if (!mac) return "error: target_mac required for pause_device";
          params = { mac, client_name: labels.get(mac) } as PauseDeviceParams;
          prefix = "pause";
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
            if (r.active) base.ops = await materializeOps(base);
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
