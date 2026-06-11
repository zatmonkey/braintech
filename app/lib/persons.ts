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

/**
 * Find the primary MAC for a group — the device credits land on. We pick
 * the FIRST MAC by membership.created_at so the choice is stable across
 * grants (the kid doesn't lose a balance just because they switched
 * devices). Returns null if the group has no member MACs.
 *
 * The "primary MAC" is an implementation detail: brain_credits is still
 * keyed by (owner_email, mac), but we stamp group_id on the row so
 * displays and the engine refactor (later) can treat balance as per-
 * person.
 */
export async function primaryMacForGroup(
  sql: NeonQueryFunction<false, false>,
  email: string,
  group_id: string,
): Promise<string | null> {
  const rows = (await sql`
    SELECT mac::text AS mac
    FROM client_group_memberships
    WHERE owner_email = ${email} AND group_id = ${group_id}
    ORDER BY created_at ASC LIMIT 1;
  `) as { mac: string }[];
  return rows[0]?.mac.toLowerCase() ?? null;
}

export type PersonBalance = {
  group_id: string;
  name: string;
  kind: "kid" | "adult" | null;
  balance_minutes: number;
};

/**
 * Per-person credit balances for the household. Sums brain_credits rows
 * by their stamped group_id (rows without a group_id are excluded —
 * they belong to devices we couldn't attribute to a person). Joins
 * account_groups to surface display info.
 */
export async function loadPersonBalances(
  sql: NeonQueryFunction<false, false>,
  email: string,
): Promise<PersonBalance[]> {
  const rows = (await sql`
    SELECT
      bc.group_id::text AS group_id,
      COALESCE(NULLIF(g.person_name, ''), g.name) AS name,
      g.kind,
      SUM(bc.balance_minutes)::int AS balance_minutes
    FROM brain_credits bc
    JOIN account_groups g
      ON g.owner_email = bc.owner_email AND g.group_id = bc.group_id
    WHERE bc.owner_email = ${email} AND bc.group_id IS NOT NULL
    GROUP BY bc.group_id, g.person_name, g.name, g.kind;
  `) as {
    group_id: string;
    name: string;
    kind: string | null;
    balance_minutes: number;
  }[];
  return rows.map((r) => ({
    group_id: r.group_id,
    name: r.name,
    kind: r.kind === "kid" || r.kind === "adult" ? r.kind : null,
    balance_minutes: Number(r.balance_minutes),
  }));
}

/**
 * Resolve a human person name (or partial match) to a group_id. Used by
 * Bri's grant_credit tool so a parent can say "grant 30 min to alex"
 * instead of typing a MAC. Case-insensitive contains-match — picks the
 * first one when ambiguous (the kid kind beats the adult kind in the
 * order).
 */
export async function resolvePersonName(
  sql: NeonQueryFunction<false, false>,
  email: string,
  name: string,
): Promise<{ group_id: string; person_name: string } | null> {
  const needle = name.trim();
  if (!needle) return null;
  const like = `%${needle.toLowerCase()}%`;
  const rows = (await sql`
    SELECT group_id, COALESCE(NULLIF(person_name, ''), name) AS person_name
    FROM account_groups
    WHERE owner_email = ${email}
      AND (
        LOWER(COALESCE(person_name, '')) LIKE ${like}
        OR LOWER(name) LIKE ${like}
      )
    ORDER BY
      CASE kind WHEN 'kid' THEN 0 WHEN 'adult' THEN 1 ELSE 2 END,
      is_default ASC,
      created_at ASC
    LIMIT 1;
  `) as { group_id: string; person_name: string }[];
  if (rows.length === 0) return null;
  return rows[0];
}
