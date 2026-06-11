/**
 * Shared schedule-rule rematerialise + grant helpers.
 *
 *   rematerializePolicies(sql, email)  →  reads current credit balances,
 *       active earn sessions, and per-rule baselines from the DB, then
 *       pushes a fresh `desired` blob to the device so the on-device
 *       engine syncs to the new state within ~25s.
 *
 *   grantCredit(sql, email, mac, minutes, source, note)  →  appends a
 *       ledger row, bumps the denormalized balance, then calls
 *       rematerializePolicies. Single funnel for Bri's grant_credit
 *       tool AND the kid-side earn endpoints.
 *
 * Pulling earn sessions + credit balances out into a shared helper means
 * any future writer (network-detected learning earn, parent's audit
 * tool, scheduled cleanup) gets correct policy push semantics by free.
 */
import type { NeonQueryFunction } from "@neondatabase/serverless";
import {
  assembleDesired,
  materializeOps,
  type AccountRule,
  type RuleType,
  type RuleParams,
  type BlockScheduleGroupParams,
  type Op,
} from "@/app/lib/rules";
import { loadGroupMacs } from "@/app/lib/groups";

type DeviceRow = { device_id: string; desired_version: number };
type RuleRow = {
  rule_id: string;
  rule_type: RuleType;
  name: string;
  summary: string | null;
  params: RuleParams;
  ops: Op[];
  active: boolean;
};

export type GrantResult = {
  ok: true;
  new_balance: number;
};

/**
 * Read the current "active earn session" map — every (mac → ends_at)
 * where ends_at is in the future. Empty map if none. Used to embed the
 * punch-through in every schedule rule's policy.json.
 */
export async function loadActiveEarnSessions(
  sql: NeonQueryFunction<false, false>,
  email: string,
): Promise<Map<string, string>> {
  const rows = (await sql`
    SELECT mac::text AS mac, active_until
    FROM earn_claims
    WHERE owner_email = ${email}
      AND active_until IS NOT NULL
      AND active_until > NOW();
  `) as { mac: string; active_until: string }[];
  const out = new Map<string, string>();
  for (const r of rows) {
    // Use the LATEST expiry if a kid (somehow) has overlapping sessions.
    const prev = out.get(r.mac.toLowerCase());
    if (!prev || r.active_until > prev) {
      out.set(r.mac.toLowerCase(), r.active_until);
    }
  }
  return out;
}

/**
 * Recompute desired ops for a household's device using current DB state
 * (rules + credit balances + earn sessions + today's baselines). Pushes
 * the new desired blob with a bumped version. No-op if the account has
 * no device or no active schedule rules.
 */
export async function rematerializePolicies(
  sql: NeonQueryFunction<false, false>,
  email: string,
): Promise<void> {
  const devs = (await sql`
    SELECT device_id, desired_version FROM devices WHERE owner_email = ${email} LIMIT 1;
  `) as DeviceRow[];
  const primary = devs[0];
  if (!primary) return;
  const allRows = (await sql`
    SELECT rule_id, rule_type, name, summary, params, ops, active
    FROM account_rules WHERE owner_email = ${email} AND device_id = ${primary.device_id};
  `) as RuleRow[];
  const hasActiveSchedule = allRows.some(
    (r) => r.active && r.rule_type === "block_schedule_group",
  );
  if (!hasActiveSchedule) return;

  const groupMacs = await loadGroupMacs(sql, email);

  // Per-rule baseline (today's minutes already used per MAC).
  const scheduleBaselines = new Map<string, Record<string, number>>();
  for (const r of allRows) {
    if (r.rule_type !== "block_schedule_group" || !r.active) continue;
    const sp = r.params as BlockScheduleGroupParams;
    const macsForRule = groupMacs.get(sp.group_id) ?? [];
    if (macsForRule.length === 0) continue;
    const usage = (await sql`
      SELECT mac::text AS mac, COUNT(DISTINCT bucket_start)::int AS minutes
      FROM client_usage_minute
      WHERE owner_email = ${email}
        AND mac = ANY(${macsForRule}::text[])
        AND app = ${sp.app_label}
        AND bucket_start >= DATE_TRUNC('day', NOW())
      GROUP BY mac;
    `) as { mac: string; minutes: number }[];
    const perMac: Record<string, number> = {};
    for (const u of usage) perMac[u.mac.toLowerCase()] = Number(u.minutes);
    scheduleBaselines.set(r.rule_id, perMac);
  }

  // Union of every MAC any active schedule rule touches — minimum query
  // surface for the per-MAC credit balance pull.
  const allRuleMacs = new Set<string>();
  for (const r of allRows) {
    if (!r.active || r.rule_type !== "block_schedule_group") continue;
    const sp = r.params as BlockScheduleGroupParams;
    for (const m of groupMacs.get(sp.group_id) ?? []) allRuleMacs.add(m);
  }
  const creditBalances = new Map<string, number>();
  if (allRuleMacs.size > 0) {
    const balances = (await sql`
      SELECT mac::text AS mac, balance_minutes
      FROM brain_credits
      WHERE owner_email = ${email}
        AND mac = ANY(${[...allRuleMacs]}::text[]);
    `) as { mac: string; balance_minutes: number }[];
    for (const b of balances) {
      creditBalances.set(b.mac.toLowerCase(), Number(b.balance_minutes));
    }
  }

  // Active earn sessions — the punch-through for /mine/earn/video.
  const earnSessions = await loadActiveEarnSessions(sql, email);

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
      if (r.active) {
        base.ops = await materializeOps(base, {
          groupMacs,
          scheduleBaselines,
          creditBalances,
          earnSessions,
        });
      }
      return base;
    }),
  );
  const desired = assembleDesired(allRules);
  const newVersion = primary.desired_version + 1;
  await sql`
    UPDATE devices SET desired = ${JSON.stringify(desired)}::jsonb, desired_version = ${newVersion}, updated_at = NOW()
    WHERE device_id = ${primary.device_id};
  `;
}

export async function grantCredit(
  sql: NeonQueryFunction<false, false>,
  email: string,
  mac: string,
  minutes: number,
  source:
    | "manual"
    | "earn_khan"
    | "earn_reading"
    | "earn_ted"
    | "earn_coding"
    | "earn_video"
    | "learning_dns",
  note: string | null,
): Promise<GrantResult> {
  await sql`
    INSERT INTO brain_credit_ledger (owner_email, mac, delta_minutes, source, rule_id, note)
    VALUES (${email}, ${mac}, ${minutes}, ${source}, NULL, ${note});
  `;
  await sql`
    INSERT INTO brain_credits (owner_email, mac, balance_minutes)
    VALUES (${email}, ${mac}, ${minutes})
    ON CONFLICT (owner_email, mac) DO UPDATE SET
      balance_minutes = brain_credits.balance_minutes + EXCLUDED.balance_minutes,
      updated_at = NOW();
  `;
  await rematerializePolicies(sql, email);
  const after = (await sql`
    SELECT balance_minutes FROM brain_credits WHERE owner_email = ${email} AND mac = ${mac};
  `) as { balance_minutes: number }[];
  return { ok: true, new_balance: after[0]?.balance_minutes ?? 0 };
}
