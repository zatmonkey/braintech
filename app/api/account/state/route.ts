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
} from "@/app/lib/db";

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

export async function GET() {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);
  await ensureChatSchema(sql);

  const devices = (await sql`
    SELECT device_id, label, mac, desired_version, reported_version, last_seen, telemetry
    FROM devices WHERE owner_email = ${email} ORDER BY created_at;
  `) as DeviceRow[];

  const labels = (await sql`
    SELECT mac, name FROM client_labels WHERE owner_email = ${email};
  `) as { mac: string; name: string }[];

  const rules = (await sql`
    SELECT rule_id, device_id, name, rule_type, summary, params, ops, active, created_at, updated_at
    FROM account_rules WHERE owner_email = ${email} ORDER BY created_at;
  `);

  const sessionId = `acct:${email}`;
  const pending = (await sql`
    SELECT pending_proposal FROM chat_sessions WHERE session_id = ${sessionId};
  `) as { pending_proposal: unknown }[];

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
    labels,
    rules,
    pending_proposal: pending[0]?.pending_proposal ?? null,
  });
}
