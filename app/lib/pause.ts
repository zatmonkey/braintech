/**
 * Rule pause (snooze). A rule with paused_until in the future is not
 * enforced: the server ships {ruleId: untilRFC3339} in paused-rules.json
 * and the on-device engine treats that rule as "allow" until the time
 * passes, then auto-resumes with no server round-trip.
 */
import type { NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

/** Currently-paused rules for a household, {ruleId: untilRFC3339}. Expired
 *  pauses are excluded (so the file only lists live pauses). */
export async function loadPausedRules(
  sql: Sql,
  email: string,
): Promise<Record<string, string>> {
  const rows = (await sql`
    SELECT rule_id, paused_until
    FROM account_rules
    WHERE owner_email = ${email} AND paused_until IS NOT NULL AND paused_until > NOW();
  `) as { rule_id: string; paused_until: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.rule_id] = new Date(r.paused_until).toISOString();
  return out;
}
