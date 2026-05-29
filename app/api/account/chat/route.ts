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
  type AccountRule,
  type Op,
  type RuleType,
  type RuleParams,
  type PauseDeviceParams,
  type BlockDomainsParams,
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

function buildContext(
  devices: DeviceRow[],
  labels: Map<string, string>,
  activeRules: RuleRow[],
  pending: PendingProposal | null,
): string {
  if (devices.length === 0) return "No Braintech device is linked to this account yet.";
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
      `Device: ${d.label ?? "Braintech device"} — ${online ? "ONLINE" : "OFFLINE"}`,
      `Firmware: ${t.firmware ?? "?"} | WAN: ${t.wan_up ? "up" : "down"} | Uptime: ${fmtUptime(t.uptime_sec)} | Config ${d.reported_version === d.desired_version ? "in sync" : "updating"}`,
      `Connected devices (${clients.length}):`,
      clientLines,
      `Active rules:\n${rules}`,
    ].join("\n");
  });
  if (pending) {
    sections.push(
      `\nPENDING PROPOSAL waiting for confirmation:\n- ${pending.name} [${pending.rule_type}] — ${pending.summary}`,
    );
  }
  return sections.join("\n\n");
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

  await sql`INSERT INTO chat_messages (session_id, role, content) VALUES (${sessionId}, 'user', ${message});`;

  const histRows = (await sql`
    SELECT role, content FROM chat_messages WHERE session_id = ${sessionId}
    ORDER BY created_at DESC, id DESC LIMIT 20;
  `) as { role: string; content: string }[];
  const history: Anthropic.MessageParam[] = histRows
    .reverse()
    .map((r) => ({ role: r.role === "user" ? "user" : "assistant", content: r.content }));

  const context = buildContext(devices, labels, activeRules, pendingInitial);

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
        let prefix: "pause" | "domains";
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
        // rebuild desired from all active rules + cleanup of all known pause rule ids
        const allRules = (await sql`
          SELECT rule_id, rule_type, name, summary, params, ops, active
          FROM account_rules WHERE owner_email = ${email} AND device_id = ${primary.device_id};
        `) as RuleRow[];
        const allPauseIds = allRules.filter((r) => r.rule_type === "pause_device").map((r) => r.rule_id);
        const active: AccountRule[] = allRules
          .filter((r) => r.active)
          .map((r) => ({
            rule_id: r.rule_id,
            rule_type: r.rule_type,
            params: r.params,
            ops: r.ops,
            name: r.name,
            summary: r.summary ?? undefined,
            active: true,
          }));
        const desired = assembleDesired(allPauseIds, active);
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
