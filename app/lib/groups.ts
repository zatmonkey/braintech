import type { NeonQueryFunction } from "@neondatabase/serverless";

export type AllDeviceRow = {
  mac: string;
  // Friendly name (from client_labels), or the device's hostname, or the
  // MAC if nothing else is known.
  display_name: string;
  // Whether a friendly label has been assigned (for UI affordances).
  has_label: boolean;
  hostname: string | null;
  ip: string | null;
  // ISO timestamp.
  last_seen: string;
  first_seen: string;
  // True when last_seen is within the connected-window (2 minutes).
  connected: boolean;
  // Groups this MAC belongs to, by group_id.
  group_ids: string[];
};

/**
 * The canonical "all devices on the network in the last 7 days" list.
 * One row per MAC, joined with client_labels (friendly name) and
 * client_group_memberships (groups). Sort: connected first, then by
 * last_seen DESC. Groups are subsets of this list — the dashboard
 * renders the same list with optional group-id filter.
 */
export async function loadAllDevices(
  sql: NeonQueryFunction<false, false>,
  email: string,
): Promise<AllDeviceRow[]> {
  const rows = (await sql`
    SELECT
      cls.mac::text AS mac,
      cls.hostname,
      cls.ip,
      cls.first_seen,
      cls.last_seen,
      cl.name AS label_name,
      COALESCE(
        (SELECT array_agg(cgm.group_id)
           FROM client_group_memberships cgm
          WHERE cgm.owner_email = cls.owner_email
            AND cgm.mac = cls.mac),
        ARRAY[]::text[]
      ) AS group_ids
    FROM client_last_seen cls
    LEFT JOIN client_labels cl
      ON cl.owner_email = cls.owner_email
     AND cl.mac = cls.mac
    WHERE cls.owner_email = ${email}
      AND cls.last_seen > NOW() - INTERVAL '7 days'
    ORDER BY cls.last_seen DESC;
  `) as Array<{
    mac: string;
    hostname: string | null;
    ip: string | null;
    first_seen: string;
    last_seen: string;
    label_name: string | null;
    group_ids: string[] | null;
  }>;

  const now = Date.now();
  return rows.map((r) => {
    const lastSeenMs = new Date(r.last_seen).getTime();
    const display = r.label_name?.trim() || r.hostname?.trim() || r.mac;
    return {
      mac: r.mac.toLowerCase(),
      display_name: display,
      has_label: !!(r.label_name && r.label_name.trim().length > 0),
      hostname: r.hostname,
      ip: r.ip,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      connected: now - lastSeenMs < 120_000,
      group_ids: r.group_ids ?? [],
    };
  });
}

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
