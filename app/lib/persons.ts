/**
 * Group-as-person helpers.
 *
 * Groups in account_groups can now represent an individual (kid or
 * adult) via the `kind` + `person_name` columns. Earnings are tracked
 * at the person level — i.e. the group level — not the device level.
 *
 *   resolveMacToPerson(sql, email, mac):
 *     given a MAC, find the group that represents the kid/adult it
 *     belongs to. We prefer kind='kid', then 'adult', then any non-
 *     default group, then the default group. Returns null if the MAC
 *     isn't a member of any group at all.
 *
 *   loadWatchedVideoIds(sql, email, group_id):
 *     set of video_ids the group has already passed a quiz on. The
 *     /mine/earn picker uses this to mark "watched" so the kid sees
 *     progress without losing the ability to rewatch.
 */
import type { NeonQueryFunction } from "@neondatabase/serverless";

export type Person = {
  group_id: string;
  name: string;
  kind: "kid" | "adult" | null;
};

export async function resolveMacToPerson(
  sql: NeonQueryFunction<false, false>,
  email: string,
  mac: string,
): Promise<Person | null> {
  // Order:
  //   1. kind='kid' (kids own most credit-earning flows)
  //   2. kind='adult'
  //   3. any non-default named group
  //   4. the default group
  // CASE-based ORDER BY keeps it one query rather than four.
  const rows = (await sql`
    SELECT g.group_id, g.name, g.person_name, g.kind, g.is_default
    FROM account_groups g
    JOIN client_group_memberships m
      ON m.owner_email = g.owner_email AND m.group_id = g.group_id
    WHERE g.owner_email = ${email} AND m.mac = ${mac}
    ORDER BY
      CASE g.kind WHEN 'kid' THEN 0 WHEN 'adult' THEN 1 ELSE 2 END,
      g.is_default ASC,
      g.created_at ASC
    LIMIT 1;
  `) as {
    group_id: string;
    name: string;
    person_name: string | null;
    kind: string | null;
    is_default: boolean;
  }[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    group_id: r.group_id,
    name: (r.person_name && r.person_name.trim()) || r.name,
    kind: r.kind === "kid" || r.kind === "adult" ? r.kind : null,
  };
}

export async function loadWatchedVideoIds(
  sql: NeonQueryFunction<false, false>,
  email: string,
  group_id: string,
): Promise<Set<string>> {
  // Any earn_claim with this video_id counts, scored or in-flight. An
  // unfinished attempt should still hide the entry — we don't want the
  // kid to spawn parallel claims for the same video as a way around the
  // 6/day rate limit.
  const rows = (await sql`
    SELECT DISTINCT video_id::text AS video_id
    FROM earn_claims
    WHERE owner_email = ${email}
      AND group_id = ${group_id}
      AND video_id IS NOT NULL;
  `) as { video_id: string }[];
  return new Set(rows.map((r) => r.video_id));
}
