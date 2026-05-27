import { createHmac, timingSafeEqual } from "node:crypto";
import { getSql, ensureDeviceSchema } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // allow the long-poll hold

const HOLD_MS = 25_000;
const POLL_MS = 2_000;

type DeviceRow = {
  device_id: string;
  psk: string;
  desired: unknown;
  desired_version: number;
};

function bearer(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}

function eq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function GET(req: Request) {
  const sql = getSql();
  if (!sql) return new Response("unavailable", { status: 503 });
  await ensureDeviceSchema(sql);

  const deviceId = req.headers.get("x-device-id") ?? "";
  const psk = bearer(req);
  if (!deviceId || !psk) return new Response("unauthorized", { status: 401 });

  const rows = (await sql`
    SELECT device_id, psk, desired, desired_version
    FROM devices WHERE device_id = ${deviceId};
  `) as DeviceRow[];
  const dev = rows[0];
  if (!dev || !eq(dev.psk, psk)) {
    return new Response("unauthorized", { status: 401 });
  }

  const since = Number(new URL(req.url).searchParams.get("since") ?? "0") || 0;
  await sql`UPDATE devices SET last_seen = NOW() WHERE device_id = ${deviceId};`;

  // Long-poll: hold until a newer desired version exists, or time out → 304.
  const deadline = Date.now() + HOLD_MS;
  let version = dev.desired_version;
  let desired = dev.desired;
  while (version <= since && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const r2 = (await sql`
      SELECT desired, desired_version FROM devices WHERE device_id = ${deviceId};
    `) as Pick<DeviceRow, "desired" | "desired_version">[];
    if (r2[0]) {
      version = r2[0].desired_version;
      desired = r2[0].desired;
    }
  }

  if (version <= since || desired == null) {
    return new Response(null, { status: 304 });
  }

  const instruction = {
    version,
    device_id: deviceId,
    issued_at: new Date().toISOString(),
    ops: desired,
  };
  const body = JSON.stringify(instruction);
  const sig = createHmac("sha256", dev.psk).update(body).digest("hex");

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Braintech-Signature": `sha256=${sig}`,
      "Cache-Control": "no-store",
    },
  });
}
