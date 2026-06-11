/**
 * Per-group activity rollups: which apps the kids are spending time on,
 * for how long, and whether the household has decided "ok" or "limit"
 * on each. Joins client_usage_minute (raw per-minute buckets) with
 * client_group_memberships (which MACs belong to which group) and
 * app_classifications (parent's decision per app per group).
 *
 * Two windows: today (since DATE_TRUNC('day', NOW())) and last 7 days.
 *
 * The default rollup ('brainrot' | 'learning' | 'other') from
 * lib/usage-apps.ts is the household-agnostic prior. An explicit
 * classification in app_classifications overrides it.
 */
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { rollupFor, type AppRollup } from "./usage-apps";

export type GroupActivityRow = {
  app: string;
  minutes_today: number;
  minutes_7d: number;
  // Parent's explicit decision for this (group, app). null = undecided.
  status: "ok" | "limit" | null;
  // Default classification when status is null. Drives the alert
  // ("undecided brainrot-ish app with >X minutes today").
  rollup: AppRollup;
  // When the classification was set (if any) — for "decided 2d ago" UX.
  decided_at: string | null;
};

export async function loadGroupActivity(
  sql: NeonQueryFunction<false, false>,
  email: string,
  group_id: string,
): Promise<GroupActivityRow[]> {
  // Pull the MACs in this group once; window-functions on client_usage
  // get expensive otherwise. Empty group → empty result.
  const macs = (await sql`
    SELECT mac::text AS mac FROM client_group_memberships
    WHERE owner_email = ${email} AND group_id = ${group_id};
  `) as { mac: string }[];
  if (macs.length === 0) return [];
  const macList = macs.map((m) => m.mac.toLowerCase());

  // One query: per-app today minutes + 7d minutes, left-joined to
  // classifications. DISTINCT bucket_start per app dedupes co-watch
  // (same minute on 2 devices = 1 minute of attention).
  const rows = (await sql`
    WITH usage AS (
      SELECT app::text AS app,
             COUNT(DISTINCT bucket_start) FILTER (WHERE bucket_start >= DATE_TRUNC('day', NOW()))::int AS minutes_today,
             COUNT(DISTINCT bucket_start) FILTER (WHERE bucket_start >  NOW() - INTERVAL '7 days')::int AS minutes_7d
      FROM client_usage_minute
      WHERE owner_email = ${email}
        AND mac = ANY(${macList}::text[])
        AND bucket_start > NOW() - INTERVAL '7 days'
      GROUP BY app
    )
    SELECT u.app, u.minutes_today, u.minutes_7d,
           c.status, c.decided_at
    FROM usage u
    LEFT JOIN app_classifications c
      ON c.owner_email = ${email}
     AND c.group_id    = ${group_id}
     AND c.app         = u.app
    WHERE u.minutes_7d > 0
    ORDER BY u.minutes_7d DESC;
  `) as {
    app: string;
    minutes_today: number;
    minutes_7d: number;
    status: string | null;
    decided_at: string | null;
  }[];

  return rows.map((r) => ({
    app: r.app,
    minutes_today: Number(r.minutes_today),
    minutes_7d: Number(r.minutes_7d),
    status: r.status === "ok" || r.status === "limit" ? r.status : null,
    rollup: rollupFor(r.app),
    decided_at: r.decided_at,
  }));
}
