/**
 * Shared "minutes already used today" baseline computation for
 * block_schedule_group rules — extracted from three near-identical copies
 * (Bri's apply path ×2, credit-grant) that all computed "today" in UTC.
 *
 * Two timezone-sensitive parts, both now in the HOUSEHOLD's timezone
 * (devices.iana_timezone, the same zone the agent's clock runs on):
 *   1. the usage window ("since local midnight", not since 5pm PDT), and
 *   2. the day KEY the baseline is filed under — the agent's counter keys
 *      days locally, so a UTC key parks the baseline on tomorrow.
 */
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { BlockScheduleGroupParams } from "./rules";

type Sql = NeonQueryFunction<false, false>;

type ScheduleRuleRow = {
  rule_id: string;
  rule_type: string;
  active: boolean;
  params: unknown;
};

export type ScheduleBaselines = {
  /** rule_id → (lowercase mac → minutes used since local midnight) */
  baselines: Map<string, Record<string, number>>;
  /** YYYY-MM-DD in the household timezone — pass as ctx.baselineDayKey. */
  dayKey: string;
  /** The household IANA timezone the above were computed in. */
  tz: string;
};

export function dayKeyInTz(tz: string, when: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(when);
}

export async function householdTimezone(sql: Sql, email: string): Promise<string> {
  const rows = (await sql`
    SELECT iana_timezone::text AS tz FROM devices
    WHERE owner_email = ${email} AND iana_timezone IS NOT NULL
    ORDER BY updated_at DESC LIMIT 1;
  `) as { tz: string }[];
  return rows[0]?.tz ?? "UTC";
}

export async function loadScheduleBaselines(
  sql: Sql,
  email: string,
  rules: ScheduleRuleRow[],
  groupMacs: Map<string, string[]>,
): Promise<ScheduleBaselines> {
  const tz = await householdTimezone(sql, email);
  const baselines = new Map<string, Record<string, number>>();
  for (const r of rules) {
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
        AND bucket_start >= DATE_TRUNC('day', NOW() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}
      GROUP BY mac;
    `) as { mac: string; minutes: number }[];
    const perMac: Record<string, number> = {};
    for (const u of usage) perMac[u.mac.toLowerCase()] = Number(u.minutes);
    baselines.set(r.rule_id, perMac);
  }
  return { baselines, dayKey: dayKeyInTz(tz), tz };
}
