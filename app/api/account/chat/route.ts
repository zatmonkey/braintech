import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import { getSql, ensureDeviceSchema, ensureChatSchema } from "@/app/lib/db";
import { runAccountChatTurn } from "@/app/lib/conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Op = { config?: string; section_type?: string; values?: Record<string, string> };
type Client = { hostname?: string; ip?: string; mac?: string; connected?: boolean };
type Telemetry = {
  model?: string;
  firmware?: string;
  uptime_sec?: number;
  wan_up?: boolean;
  clients?: Client[];
};
type Row = {
  label: string | null;
  desired: Op[] | null;
  desired_version: number;
  reported_version: number;
  last_seen: string | null;
  telemetry: Telemetry | null;
};

function fmtUptime(s?: number): string {
  if (!s) return "unknown";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function buildContext(devices: Row[]): string {
  if (devices.length === 0) return "No Braintech device is linked to this account yet.";
  return devices
    .map((d) => {
      const online = d.last_seen && Date.now() - new Date(d.last_seen).getTime() < 120_000;
      const t = d.telemetry ?? {};
      const clients = (t.clients ?? []).filter((c) => c.ip && !c.ip.startsWith("fe80"));
      const clientLines = clients.length
        ? clients
            .map((c) => `- ${c.hostname || "unnamed"} (${c.ip}, ${c.mac})${c.connected ? "" : " [idle]"}`)
            .join("\n")
        : "- (none seen yet)";
      const rules = (d.desired ?? [])
        .filter((o) => o.config === "firewall" && o.section_type === "rule" && o.values?.name)
        .map((o) => o.values!.name);
      return [
        `Device: ${d.label ?? "Braintech device"} — ${online ? "ONLINE" : "OFFLINE"}`,
        `Firmware: ${t.firmware ?? "?"} | WAN: ${t.wan_up ? "up" : "down"} | Uptime: ${fmtUptime(t.uptime_sec)} | Config ${d.reported_version === d.desired_version ? "in sync" : "updating"}`,
        `Connected devices (${clients.length}):`,
        clientLines,
        `Active rules: ${rules.length ? rules.join(", ") : "none yet"}`,
      ].join("\n");
    })
    .join("\n\n");
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

  const devices = (await sql`
    SELECT label, desired, desired_version, reported_version, last_seen, telemetry
    FROM devices WHERE owner_email = ${email} ORDER BY created_at;
  `) as Row[];
  const context = buildContext(devices);

  const sessionId = `acct:${email}`;
  await sql`INSERT INTO chat_sessions (session_id, email) VALUES (${sessionId}, ${email})
            ON CONFLICT (session_id) DO UPDATE SET updated_at = NOW();`;
  await sql`INSERT INTO chat_messages (session_id, role, content) VALUES (${sessionId}, 'user', ${message});`;

  const rows = (await sql`
    SELECT role, content FROM chat_messages WHERE session_id = ${sessionId}
    ORDER BY created_at DESC, id DESC LIMIT 20;
  `) as { role: string; content: string }[];
  const history: Anthropic.MessageParam[] = rows
    .reverse()
    .map((r) => ({ role: r.role === "user" ? "user" : "assistant", content: r.content }));

  const { reply } = await runAccountChatTurn({ history, context });

  await sql`INSERT INTO chat_messages (session_id, role, content) VALUES (${sessionId}, 'assistant', ${reply});`;
  return NextResponse.json({ reply });
}
