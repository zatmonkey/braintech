import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSql, ensureDeviceSchema } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearer(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}
function eq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function POST(req: Request) {
  const sql = getSql();
  if (!sql) return new Response("unavailable", { status: 503 });
  await ensureDeviceSchema(sql);

  const deviceId = req.headers.get("x-device-id") ?? "";
  const psk = bearer(req);
  if (!deviceId || !psk) return new Response("unauthorized", { status: 401 });

  const rows = (await sql`SELECT psk FROM devices WHERE device_id = ${deviceId};`) as {
    psk: string;
  }[];
  if (!rows[0] || !eq(rows[0].psk, psk)) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  await sql`
    UPDATE devices SET
      telemetry = ${JSON.stringify(body)}::jsonb,
      telemetry_at = NOW(),
      last_seen = NOW()
    WHERE device_id = ${deviceId};
  `;

  // Per-MAC presence: upsert one row per visible client into the registry.
  // The dashboard reads this to render the canonical "all devices last
  // 7 days" list — groups become a tag/filter on top instead of a
  // duplicate parallel list.
  const ownerRows = (await sql`
    SELECT owner_email FROM devices WHERE device_id = ${deviceId};
  `) as { owner_email: string | null }[];
  const owner = ownerRows[0]?.owner_email;
  if (owner) {
    const clients = Array.isArray((body as { clients?: unknown[] })?.clients)
      ? ((body as { clients: unknown[] }).clients as Array<{
          mac?: string;
          ip?: string;
          hostname?: string;
        }>)
      : [];
    for (const c of clients) {
      if (typeof c.mac !== "string") continue;
      const mac = c.mac.toLowerCase();
      if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac)) continue;
      // Skip link-local IPv6 — those are noise, not actual home devices.
      if (typeof c.ip === "string" && c.ip.toLowerCase().startsWith("fe80")) {
        continue;
      }
      const ip = typeof c.ip === "string" ? c.ip.slice(0, 64) : null;
      const hostname =
        typeof c.hostname === "string" ? c.hostname.slice(0, 128) : null;
      try {
        await sql`
          INSERT INTO client_last_seen (owner_email, mac, hostname, ip)
          VALUES (${owner}, ${mac}, ${hostname}, ${ip})
          ON CONFLICT (owner_email, mac) DO UPDATE SET
            hostname  = COALESCE(EXCLUDED.hostname, client_last_seen.hostname),
            ip        = COALESCE(EXCLUDED.ip, client_last_seen.ip),
            last_seen = NOW();
        `;
      } catch (err) {
        console.error("[telemetry] last-seen upsert failed", err);
      }
    }
  }

  // Per-minute usage rollups: each row is (mac, minute_utc, app, count).
  // The agent classifies into app names ("TikTok", "YouTube", "Khan
  // Academy"…). Server stores them as-is — the brainrot rollup happens
  // in app/lib/usage-apps.ts so we can edit the brainrot/learning split
  // without touching the agent.
  if (owner) {
    type UsageRow = {
      mac?: string;
      minute_utc?: string;
      app?: string;
      query_count?: number;
    };
    const usage = Array.isArray((body as { usage?: unknown[] }).usage)
      ? ((body as { usage: UsageRow[] }).usage)
      : [];
    for (const u of usage) {
      if (typeof u.mac !== "string") continue;
      const mac = u.mac.toLowerCase();
      if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac)) continue;
      if (typeof u.minute_utc !== "string") continue;
      const minute = u.minute_utc;
      if (typeof u.app !== "string" || u.app.length === 0 || u.app.length > 64) {
        continue;
      }
      const app = u.app;
      const count =
        typeof u.query_count === "number" && u.query_count > 0
          ? Math.min(u.query_count, 100_000)
          : 1;
      try {
        await sql`
          INSERT INTO client_usage_minute
            (owner_email, mac, bucket_start, app, query_count)
          VALUES
            (${owner}, ${mac}, ${minute}::timestamptz, ${app}, ${count})
          ON CONFLICT (owner_email, mac, bucket_start, app) DO UPDATE SET
            query_count = GREATEST(client_usage_minute.query_count, EXCLUDED.query_count);
        `;
      } catch (err) {
        console.error("[telemetry] usage upsert failed", err);
      }
    }

    // Credit spend reports — the agent ships per-(mac, rule_id, day)
    // running totals. We track the last-ack'd total in
    // brain_credit_spend_ack and debit only the delta from brain_credits,
    // writing one ledger row for the delta. Idempotent: re-receiving the
    // same total has no effect.
    type CreditRow = {
      mac?: string;
      rule_id?: string;
      day?: string;
      spend_minutes?: number;
    };
    const credits = Array.isArray((body as { credit_spend?: unknown[] }).credit_spend)
      ? ((body as { credit_spend: CreditRow[] }).credit_spend)
      : [];
    for (const c of credits) {
      if (typeof c.mac !== "string") continue;
      const mac = c.mac.toLowerCase();
      if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac)) continue;
      if (typeof c.rule_id !== "string" || c.rule_id.length === 0) continue;
      if (typeof c.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(c.day)) continue;
      const total =
        typeof c.spend_minutes === "number" && c.spend_minutes >= 0
          ? Math.min(Math.floor(c.spend_minutes), 100_000)
          : 0;
      try {
        const prior = (await sql`
          SELECT total_spent FROM brain_credit_spend_ack
          WHERE owner_email = ${owner} AND mac = ${mac}
            AND rule_id = ${c.rule_id} AND day = ${c.day}::date;
        `) as { total_spent: number }[];
        const priorTotal = prior[0]?.total_spent ?? 0;
        const delta = total - priorTotal;
        if (delta <= 0) continue;
        await sql`
          INSERT INTO brain_credit_ledger (owner_email, mac, delta_minutes, source, rule_id, note)
          VALUES (${owner}, ${mac}, ${-delta}, 'spend', ${c.rule_id}, ${`auto-spend on ${c.day}`});
        `;
        await sql`
          UPDATE brain_credits
             SET balance_minutes = GREATEST(0, balance_minutes - ${delta}),
                 updated_at = NOW()
           WHERE owner_email = ${owner} AND mac = ${mac};
        `;
        await sql`
          INSERT INTO brain_credit_spend_ack (owner_email, mac, rule_id, day, total_spent)
          VALUES (${owner}, ${mac}, ${c.rule_id}, ${c.day}::date, ${total})
          ON CONFLICT (owner_email, mac, rule_id, day) DO UPDATE SET
            total_spent = EXCLUDED.total_spent,
            updated_at = NOW();
        `;
      } catch (err) {
        console.error("[telemetry] credit spend ack failed", err);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
