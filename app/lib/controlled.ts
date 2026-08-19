/**
 * Controlled-device scoping for deep-packet enforcement.
 *
 * A group flagged `controlled` subjects its devices to firewall-level
 * enforcement (DNS-gated drop, SNI verdicts, flow classification) instead
 * of DNS filtering alone. This helper resolves the union of MACs across a
 * household's controlled groups — the exact set the device turns into the
 * bt_controlled_macs nft set. Adult (uncontrolled) devices are absent, so
 * every DPI stage no-ops on them.
 */
import type { NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

export async function loadControlledMacs(
  sql: Sql,
  email: string,
): Promise<string[]> {
  const rows = (await sql`
    SELECT DISTINCT LOWER(cgm.mac) AS mac
    FROM client_group_memberships cgm
    JOIN account_groups g
      ON g.owner_email = cgm.owner_email AND g.group_id = cgm.group_id
    WHERE cgm.owner_email = ${email} AND g.controlled = TRUE;
  `) as { mac: string }[];
  return rows.map((r) => r.mac).sort();
}
