/**
 * Shared helper: append a credit grant to the ledger, bump the
 * denormalized balance, and re-materialize every active schedule rule's
 * policy.json so the on-device engine sees the new balance within ~25s.
 *
 * Used by:
 *   - Bri's grant_credit tool (parent says "give Maya 30 min")
 *   - The earn endpoint (kid passed a quiz)
 *
 * Both writers go through this single path so:
 *   - Schema invariants (balance == sum(ledger) per mac) stay intact
 *   - Policy push semantics are identical regardless of grant source
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

export async function grantCredit(
  sql: NeonQueryFunction<false, false>,
  email: string,
  mac: string,
  minutes: number,
  source: "manual" | "earn_khan" | "earn_reading" | "earn_ted" | "earn_coding" | "learning_dns",
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

  // Push the new balance to the device by re-materializing every active
  // schedule rule. The agent picks it up on its next sync (~25s).
  const devs = (await sql`
    SELECT device_id, desired_version FROM devices WHERE owner_email = ${email} LIMIT 1;
  `) as DeviceRow[];
  const primary = devs[0];
  if (primary) {
    const allRows = (await sql`
      SELECT rule_id, rule_type, name, summary, params, ops, active
      FROM account_rules WHERE owner_email = ${email} AND device_id = ${primary.device_id};
    `) as RuleRow[];
    const hasActiveSchedule = allRows.some(
      (r) => r.active && r.rule_type === "block_schedule_group",
    );
    if (hasActiveSchedule) {
      const groupMacs = await loadGroupMacs(sql, email);
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
  }

  const after = (await sql`
    SELECT balance_minutes FROM brain_credits WHERE owner_email = ${email} AND mac = ${mac};
  `) as { balance_minutes: number }[];
  return { ok: true, new_balance: after[0]?.balance_minutes ?? 0 };
}
