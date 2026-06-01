import type { NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Load { group_id → [mac, ...] } for one account. Used by every rule-assembly
 * site (chat apply, DELETE rule, reset, cron) to materialize pause_group rules
 * against current membership. MACs are lowercased on the way out.
 */
export async function loadGroupMacs(
  sql: NeonQueryFunction<false, false>,
  email: string,
): Promise<Map<string, string[]>> {
  const rows = (await sql`
    SELECT group_id, mac FROM client_labels
    WHERE owner_email = ${email} AND group_id IS NOT NULL;
  `) as { group_id: string; mac: string }[];
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const m = map.get(r.group_id) ?? [];
    m.push(r.mac.toLowerCase());
    map.set(r.group_id, m);
  }
  return map;
}
