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

  let body: {
    version?: number;
    status?: string;
    error?: string;
    agent_version?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const version = Number(body.version ?? 0) || 0;
  const status = String(body.status ?? "").slice(0, 32);

  await sql`
    UPDATE devices SET
      reported_version = CASE WHEN ${status} = 'applied' THEN ${version} ELSE reported_version END,
      last_status = ${status},
      last_seen = NOW(),
      updated_at = NOW()
    WHERE device_id = ${deviceId};
  `;
  console.log("[device.report]", { deviceId, version, status, error: body.error });

  return NextResponse.json({ ok: true });
}
