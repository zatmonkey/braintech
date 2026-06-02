import type { NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Load { group_id → [mac, ...] } for one account from the many-to-many
 * junction. Used by every rule-assembly site (chat apply, DELETE rule,
 * reset, cron) to materialize pause_group rules against current membership.
 * MACs are lowercased on the way out.
 */
export async function loadGroupMacs(
  sql: NeonQueryFunction<false, false>,
  email: string,
): Promise<Map<string, string[]>> {
  const rows = (await sql`
    SELECT group_id, mac FROM client_group_memberships
    WHERE owner_email = ${email};
  `) as { group_id: string; mac: string }[];
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const m = map.get(r.group_id) ?? [];
    m.push(r.mac.toLowerCase());
    map.set(r.group_id, m);
  }
  return map;
}

/**
 * Load { mac → [group_id, ...] } so the dashboard can render which groups
 * each connected device belongs to (as chips).
 */
export async function loadMacGroups(
  sql: NeonQueryFunction<false, false>,
  email: string,
): Promise<Map<string, string[]>> {
  const rows = (await sql`
    SELECT mac, group_id FROM client_group_memberships
    WHERE owner_email = ${email};
  `) as { mac: string; group_id: string }[];
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const m = r.mac.toLowerCase();
    const list = map.get(m) ?? [];
    list.push(r.group_id);
    map.set(m, list);
  }
  return map;
}
