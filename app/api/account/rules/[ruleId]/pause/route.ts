// Pause (snooze) or resume a rule. POST { minutes } sets paused_until =
// now + minutes and pushes a fresh desired so the device stops enforcing
// within one sync; minutes <= 0 (or { resume: true }) clears the pause.
// The device auto-resumes on its own when the time passes, but clearing
// the DB row keeps the dashboard honest and lets a later re-materialize
// know the pause is over.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import { getSql, ensureDeviceSchema, ensureAccountSchema } from "@/app/lib/db";
import {
  assembleDesired,
  buildRuleOps,
  materializeOps,
  type AccountRule,
  type Op,
  type RuleType,
  type RuleParams,
} from "@/app/lib/rules";
import { loadGroupMacs } from "@/app/lib/groups";
import { loadControlledMacs } from "@/app/lib/controlled";
import { loadAppCreditsByMac } from "@/app/lib/app-credit";
import { loadPausedRules } from "@/app/lib/pause";
import { loadScheduleBaselines } from "@/app/lib/schedule-baselines";
import { logRuleAudit } from "@/app/lib/rule-audit";

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

const MAX_PAUSE_MINUTES = 14 * 24 * 60; // 2 weeks — a snooze, not a delete.

export async function POST(req: NextRequest, ctx: { params: Promise<{ ruleId: string }> }) {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { ruleId } = await ctx.params;
  let body: { minutes?: number; resume?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const resume = body.resume === true || (typeof body.minutes === "number" && body.minutes <= 0);
  const minutes = Math.floor(Number(body.minutes ?? 0));
  if (!resume && (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_PAUSE_MINUTES)) {
    return NextResponse.json({ error: `minutes must be 1..${MAX_PAUSE_MINUTES}` }, { status: 400 });
  }

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);

  const owned = (await sql`
    SELECT device_id, name, active FROM account_rules
    WHERE rule_id = ${ruleId} AND owner_email = ${email} LIMIT 1;
  `) as { device_id: string; name: string; active: boolean }[];
  const rule = owned[0];
  if (!rule) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!rule.active && !resume) {
    return NextResponse.json({ error: "rule is not active" }, { status: 400 });
  }

  let pausedUntil: string | null = null;
  if (resume) {
    await sql`UPDATE account_rules SET paused_until = NULL, updated_at = NOW()
              WHERE rule_id = ${ruleId} AND owner_email = ${email};`;
  } else {
    const rows = (await sql`
      UPDATE account_rules SET paused_until = NOW() + (${minutes} * INTERVAL '1 minute'), updated_at = NOW()
      WHERE rule_id = ${ruleId} AND owner_email = ${email}
      RETURNING paused_until;
    `) as { paused_until: string }[];
    pausedUntil = rows[0] ? new Date(rows[0].paused_until).toISOString() : null;
  }
  await logRuleAudit(sql, {
    owner_email: email,
    rule_id: ruleId,
    action: resume ? "resume" : "pause",
    source: "dashboard",
    actor: email,
    detail: resume ? rule.name : `${rule.name} for ${minutes}m`,
  });

  // Rebuild + push desired so paused-rules.json (and enforcement) tracks
  // the change now; carry the other device-wide files so none get blanked.
  const all = (await sql`
    SELECT rule_id, device_id, rule_type, params, ops, active, name, summary
    FROM account_rules WHERE owner_email = ${email} AND device_id = ${rule.device_id};
  `) as RuleRow[];
  const groupMacs = await loadGroupMacs(sql, email);
  const { baselines: scheduleBaselines, dayKey: baselineDayKey } =
    await loadScheduleBaselines(sql, email, all, groupMacs);
  const allRules: AccountRule[] = await Promise.all(
    all.map(async (r) => {
      const base: AccountRule = {
        rule_id: r.rule_id,
        rule_type: r.rule_type,
        params: r.params,
        ops: r.active ? buildRuleOps(r.rule_id, r.rule_type, r.params) : r.ops,
        name: r.name,
        summary: r.summary ?? undefined,
        active: r.active,
      };
      if (r.active) base.ops = await materializeOps(base, { groupMacs, scheduleBaselines, baselineDayKey });
      return base;
    }),
  );
  const controlledMacs = await loadControlledMacs(sql, email);
  const appCredits = await loadAppCreditsByMac(sql, email, controlledMacs);
  const pausedRules = await loadPausedRules(sql, email);
  const devRows = (await sql`
    SELECT desired_version, iana_timezone, posix_timezone FROM devices
    WHERE device_id = ${rule.device_id} AND owner_email = ${email};
  `) as { desired_version: number; iana_timezone: string | null; posix_timezone: string | null }[];
  const dev = devRows[0];
  const tz = dev?.iana_timezone && dev?.posix_timezone ? { iana: dev.iana_timezone, posix: dev.posix_timezone } : undefined;
  const desired = assembleDesired(allRules, { timezone: tz, controlledMacs, appCredits, pausedRules });
  await sql`
    UPDATE devices SET desired = ${JSON.stringify(desired)}::jsonb,
      desired_version = ${(dev?.desired_version ?? 0) + 1}, updated_at = NOW()
    WHERE device_id = ${rule.device_id};
  `;

  return NextResponse.json({ ok: true, rule_id: ruleId, paused_until: pausedUntil });
}
