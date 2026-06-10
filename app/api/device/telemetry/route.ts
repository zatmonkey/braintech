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

  // Per-minute usage rollups: each row is (mac, minute_utc, category, count).
  // The agent pre-classifies via its dnsmasq query log tailer. Server stores
  // each (owner, mac, minute, category) idempotently — re-sends of the same
  // minute just keep the highest query_count (in case telemetry races).
  if (owner) {
    type UsageRow = {
      mac?: string;
      minute_utc?: string;
      category?: string;
      query_count?: number;
    };
    const usage = Array.isArray((body as { usage?: unknown[] }).usage)
      ? ((body as { usage: UsageRow[] }).usage)
      : [];
    const validCategories = new Set([
      "social",
      "video",
      "games",
      "learning",
      "other",
    ]);
    for (const u of usage) {
      if (typeof u.mac !== "string") continue;
      const mac = u.mac.toLowerCase();
      if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac)) continue;
      if (typeof u.minute_utc !== "string") continue;
      const minute = u.minute_utc;
      if (typeof u.category !== "string") continue;
      const cat = u.category.toLowerCase();
      if (!validCategories.has(cat)) continue;
      const count =
        typeof u.query_count === "number" && u.query_count > 0
          ? Math.min(u.query_count, 100_000)
          : 1;
      try {
        await sql`
          INSERT INTO client_usage_minute
            (owner_email, mac, bucket_start, category, query_count)
          VALUES
            (${owner}, ${mac}, ${minute}::timestamptz, ${cat}, ${count})
          ON CONFLICT (owner_email, mac, bucket_start, category) DO UPDATE SET
            query_count = GREATEST(client_usage_minute.query_count, EXCLUDED.query_count);
        `;
      } catch (err) {
        console.error("[telemetry] usage upsert failed", err);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
