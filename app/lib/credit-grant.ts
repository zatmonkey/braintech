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
import { primaryMacForGroup } from "@/app/lib/persons";

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

export type DeductResult = {
  ok: true;
  // How many minutes were actually removed (clamped at the current
  // balance — we never go negative). Caller can compare against the
  // requested amount to detect "tried to take 30 but only 12 were
  // there".
  deducted: number;
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

/**
 * Grant credit to a person (identified by group_id) or directly to a
 * device (identified by MAC). The storage row is still keyed by
 * (owner_email, mac) — the on-device engine spends per-MAC — but every
 * row gets stamped with a group_id so the dashboard, Bri's reply text,
 * and a future per-group engine all read one balance per person.
 *
 * - If only group_id is supplied, we resolve to that group's primary
 *   MAC (the device the credit will physically land on).
 * - If only mac is supplied, we resolve the group from current
 *   membership and stamp it on the row. Backwards-compatible path.
 * - If both are supplied, we trust the caller (used when the caller has
 *   already resolved both, e.g. /api/account/earn/submit).
 */
export async function grantCredit(
  sql: NeonQueryFunction<false, false>,
  email: string,
  target: { group_id?: string; mac?: string },
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
  let groupId = target.group_id ?? null;
  let mac = target.mac ?? null;

  if (!mac && groupId) {
    mac = await primaryMacForGroup(sql, email, groupId);
    if (!mac) {
      throw new Error(
        `cannot grant credit: group ${groupId} has no member devices yet`,
      );
    }
  }
  if (!mac) {
    throw new Error("cannot grant credit: need group_id or mac");
  }
  if (!groupId) {
    // Back-compat: caller passed a MAC only. Look up the group it
    // belongs to so the ledger row carries person attribution.
    const rows = (await sql`
      SELECT cgm.group_id::text AS group_id
      FROM client_group_memberships cgm
      WHERE cgm.owner_email = ${email} AND cgm.mac = ${mac}
      ORDER BY cgm.created_at ASC LIMIT 1;
    `) as { group_id: string }[];
    groupId = rows[0]?.group_id ?? null;
  }

  await sql`
    INSERT INTO brain_credit_ledger (owner_email, mac, group_id, delta_minutes, source, rule_id, note)
    VALUES (${email}, ${mac}, ${groupId}, ${minutes}, ${source}, NULL, ${note});
  `;
  await sql`
    INSERT INTO brain_credits (owner_email, mac, group_id, balance_minutes)
    VALUES (${email}, ${mac}, ${groupId}, ${minutes})
    ON CONFLICT (owner_email, mac) DO UPDATE SET
      balance_minutes = brain_credits.balance_minutes + EXCLUDED.balance_minutes,
      group_id = COALESCE(brain_credits.group_id, EXCLUDED.group_id),
      updated_at = NOW();
  `;
  await rematerializePolicies(sql, email);
  const after = (await sql`
    SELECT balance_minutes FROM brain_credits WHERE owner_email = ${email} AND mac = ${mac};
  `) as { balance_minutes: number }[];
  return { ok: true, new_balance: after[0]?.balance_minutes ?? 0 };
}

/**
 * Remove brain credit from a kid. Mirrors grantCredit's target shape
 * (group_id or mac) and clamps at the current balance — we never let
 * a kid go to a negative pool. Records a negative delta_minutes row
 * with source='manual_deduct' so the ledger reads cleanly without
 * mixing into "all grants" filters.
 *
 * Returns the actual minutes removed (may be less than requested if
 * the balance was insufficient) so Bri can phrase the reply honestly
 * ("Took 12 of the 30 you asked for — that's all they had").
 */
export async function deductCredit(
  sql: NeonQueryFunction<false, false>,
  email: string,
  target: { group_id?: string; mac?: string },
  minutes: number,
  note: string | null,
): Promise<DeductResult> {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error("deduct minutes must be a positive integer");
  }
  let groupId = target.group_id ?? null;
  let mac = target.mac ?? null;

  if (!mac && groupId) {
    mac = await primaryMacForGroup(sql, email, groupId);
    if (!mac) {
      throw new Error(
        `cannot deduct credit: group ${groupId} has no member devices yet`,
      );
    }
  }
  if (!mac) {
    throw new Error("cannot deduct credit: need group_id or mac");
  }
  if (!groupId) {
    const rows = (await sql`
      SELECT cgm.group_id::text AS group_id
      FROM client_group_memberships cgm
      WHERE cgm.owner_email = ${email} AND cgm.mac = ${mac}
      ORDER BY cgm.created_at ASC LIMIT 1;
    `) as { group_id: string }[];
    groupId = rows[0]?.group_id ?? null;
  }

  // Read-clamp-write. Concurrent deducts could in theory race the
  // balance below zero; in practice manual grants/deducts come from a
  // single human path and the spend telemetry never reads this. The
  // GREATEST(0, …) in the UPDATE catches any actual underflow.
  const before = (await sql`
    SELECT balance_minutes FROM brain_credits
    WHERE owner_email = ${email} AND mac = ${mac};
  `) as { balance_minutes: number }[];
  if (before.length === 0) {
    // No row at all — nothing to deduct, no harm done.
    return { ok: true, deducted: 0, new_balance: 0 };
  }
  const currentBalance = Number(before[0].balance_minutes);
  const deducted = Math.min(minutes, currentBalance);
  const newBalance = currentBalance - deducted;

  await sql`
    UPDATE brain_credits
       SET balance_minutes = GREATEST(0, ${newBalance}),
           updated_at      = NOW(),
           group_id        = COALESCE(group_id, ${groupId})
     WHERE owner_email = ${email} AND mac = ${mac};
  `;
  await sql`
    INSERT INTO brain_credit_ledger (owner_email, mac, group_id, delta_minutes, source, rule_id, note)
    VALUES (${email}, ${mac}, ${groupId}, ${-deducted}, 'manual_deduct', NULL, ${note});
  `;
  await rematerializePolicies(sql, email);
  return { ok: true, deducted, new_balance: newBalance };
}
