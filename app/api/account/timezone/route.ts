import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import {
  getSql,
  ensureDeviceSchema,
  ensureAccountSchema,
} from "@/app/lib/db";
import {
  assembleDesired,
  materializeOps,
  type AccountRule,
  type Op,
  type RuleType,
  type RuleParams,
} from "@/app/lib/rules";
import { loadGroupMacs } from "@/app/lib/groups";
import { ianaToPosix, isPlausibleIanaName } from "@/app/lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RuleRow = {
  rule_id: string;
  device_id: string;
  rule_type: RuleType;
  params: RuleParams;
  ops: Op[];
  active: boolean;
  name: string;
  summary: string | null;
};

/**
 * Set the household's primary device timezone.
 *
 * The dashboard auto-fires this on mount using the browser's
 * Intl.DateTimeFormat().resolvedOptions().timeZone. We map IANA → POSIX
 * (because OpenWrt's UCI expects the POSIX string, not the IANA label),
 * persist both names, and bump the desired version so the next agent
 * sync applies `uci set system.@system[0].zonename/timezone` and reloads
 * the system service.
 *
 * Idempotent: when iana hasn't changed, we skip the version bump. Saves
 * the kid an extra "Config updating" flicker for every dashboard load.
 */
export async function POST(req: Request) {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { iana?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const iana = (body.iana ?? "").trim();
  if (!isPlausibleIanaName(iana)) {
    return NextResponse.json({ error: "invalid iana name" }, { status: 400 });
  }
  const posix = ianaToPosix(iana);
  if (!posix) {
    return NextResponse.json(
      { error: `unsupported timezone: ${iana} — add to IANA_TO_POSIX` },
      { status: 400 },
    );
  }

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);

  const devs = (await sql`
    SELECT device_id, desired_version, iana_timezone, posix_timezone
    FROM devices WHERE owner_email = ${email}
    ORDER BY created_at LIMIT 1;
  `) as {
    device_id: string;
    desired_version: number;
    iana_timezone: string | null;
    posix_timezone: string | null;
  }[];
  const dev = devs[0];
  if (!dev) return NextResponse.json({ error: "no device" }, { status: 404 });

  // Already set to this exact IANA — no-op. Saves a desired_version bump
  // (and the resulting agent re-apply) on every dashboard load.
  if (dev.iana_timezone === iana && dev.posix_timezone === posix) {
    return NextResponse.json({ ok: true, unchanged: true, iana, posix });
  }

  await sql`
    UPDATE devices
    SET iana_timezone = ${iana}, posix_timezone = ${posix}, updated_at = NOW()
    WHERE device_id = ${dev.device_id};
  `;

  // Rebuild desired with the new timezone in the preamble. Pure rule
  // materialization is unchanged — only the system-config preamble shifts.
  const all = (await sql`
    SELECT rule_id, device_id, rule_type, params, ops, active, name, summary
    FROM account_rules WHERE owner_email = ${email} AND device_id = ${dev.device_id};
  `) as RuleRow[];
  const groupMacs = await loadGroupMacs(sql, email);
  const allRules: AccountRule[] = await Promise.all(
    all.map(async (r) => {
      const base: AccountRule = {
        rule_id: r.rule_id,
        rule_type: r.rule_type,
        params: r.params,
        ops: r.ops,
        name: r.name,
        summary: r.summary ?? undefined,
        active: r.active,
      };
      if (r.active) base.ops = await materializeOps(base, { groupMacs });
      return base;
    }),
  );
  const desired = assembleDesired(allRules, { timezone: { iana, posix } });
  const next = dev.desired_version + 1;
  await sql`
    UPDATE devices
    SET desired = ${JSON.stringify(desired)}::jsonb, desired_version = ${next}, updated_at = NOW()
    WHERE device_id = ${dev.device_id};
  `;

  return NextResponse.json({
    ok: true,
    iana,
    posix,
    desired_version: next,
  });
}

/** GET — return current timezone for the household's primary device. Used
 *  by the dashboard's tiny "Timezone: …" footer. */
export async function GET() {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await ensureDeviceSchema(sql);
  const devs = (await sql`
    SELECT iana_timezone, posix_timezone FROM devices
    WHERE owner_email = ${email} ORDER BY created_at LIMIT 1;
  `) as { iana_timezone: string | null; posix_timezone: string | null }[];
  return NextResponse.json({
    ok: true,
    iana: devs[0]?.iana_timezone ?? null,
    posix: devs[0]?.posix_timezone ?? null,
  });
}
