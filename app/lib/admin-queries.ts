/**
 * Server-side queries that power the /app/admin surfaces.
 *
 * Centralized here so the three admin pages (hub, earn, business) can
 * share helpers without importing each other. None of these write —
 * the admin surfaces are read-only views, edits flow back through the
 * existing Bri tools or scripts/.
 */
import type { NeonQueryFunction } from "@neondatabase/serverless";

// ────────────────────────────────────────────────────────────────────
// Hub-card stats
// ────────────────────────────────────────────────────────────────────

export type HubStats = {
  // "next post in 2d" — null when nothing is scheduled in the future.
  nextContentPostDays: number | null;
  // Earn catalog size + how many have at least one passed claim.
  videoCount: number;
  videosWatched: number;
  // Last 7 days revenue (sum of deposit_amount minor) per currency.
  revenue7dByCurrency: Array<{ currency: string; amount: number }>;
  signups7d: number;
};

export async function loadHubStats(
  sql: NeonQueryFunction<false, false>,
  videoCatalogIds: string[],
): Promise<HubStats> {
  const [contentRow, watchedRow, revenueRows, signupsRow] = (await Promise.all([
    sql`
      SELECT EXTRACT(DAY FROM (MIN(scheduled_for) - CURRENT_DATE))::int AS days
      FROM content_calendar
      WHERE posted_at IS NULL
        AND scheduled_for >= CURRENT_DATE;
    `,
    sql`
      SELECT COUNT(DISTINCT video_id)::int AS n
      FROM earn_claims
      WHERE passed = TRUE
        AND video_id IS NOT NULL;
    `,
    sql`
      SELECT COALESCE(currency, 'usd') AS currency,
             COALESCE(SUM(deposit_amount), 0)::bigint AS amount_minor
      FROM leads
      WHERE deposit_paid
        AND deposit_at > NOW() - INTERVAL '7 days'
      GROUP BY currency;
    `,
    sql`
      SELECT COUNT(*)::int AS n
      FROM waitlist
      WHERE created_at > NOW() - INTERVAL '7 days';
    `,
  ])) as unknown as [
    { days: number | null }[],
    { n: number }[],
    { currency: string; amount_minor: string | number }[],
    { n: number }[],
  ];

  return {
    nextContentPostDays:
      contentRow[0]?.days === null || contentRow[0]?.days === undefined
        ? null
        : Number(contentRow[0].days),
    videoCount: videoCatalogIds.length,
    videosWatched: watchedRow[0]?.n ?? 0,
    revenue7dByCurrency: revenueRows.map((r) => ({
      currency: r.currency,
      amount: Number(r.amount_minor) || 0,
    })),
    signups7d: signupsRow[0]?.n ?? 0,
  };
}

// ────────────────────────────────────────────────────────────────────
// Earn manager — per-video watch stats
// ────────────────────────────────────────────────────────────────────

export type EarnVideoStats = {
  video_id: string;
  attempts: number;
  passes: number;
  // Display name of each person who attempted (deduped); pulled from
  // account_groups.person_name (falls back to name) joined via
  // earn_claims.group_id.
  watchers: string[];
};

export async function loadEarnVideoStats(
  sql: NeonQueryFunction<false, false>,
): Promise<Map<string, EarnVideoStats>> {
  // One row per (video_id, group). We aggregate to per-video in JS so
  // the watchers list stays an ordered de-duped string.
  const rows = (await sql`
    SELECT ec.video_id::text AS video_id,
           COALESCE(NULLIF(g.person_name, ''), g.name, '(unknown)') AS watcher,
           COUNT(*)::int                                AS attempts,
           COUNT(*) FILTER (WHERE ec.passed = TRUE)::int AS passes
    FROM earn_claims ec
    LEFT JOIN account_groups g ON g.group_id = ec.group_id
    WHERE ec.video_id IS NOT NULL
    GROUP BY ec.video_id, watcher
    ORDER BY ec.video_id, attempts DESC;
  `) as { video_id: string; watcher: string; attempts: number; passes: number }[];

  const map = new Map<string, EarnVideoStats>();
  for (const r of rows) {
    const cur = map.get(r.video_id) ?? {
      video_id: r.video_id,
      attempts: 0,
      passes: 0,
      watchers: [] as string[],
    };
    cur.attempts += Number(r.attempts);
    cur.passes += Number(r.passes);
    if (!cur.watchers.includes(r.watcher)) cur.watchers.push(r.watcher);
    map.set(r.video_id, cur);
  }
  return map;
}

// ────────────────────────────────────────────────────────────────────
// Business dashboard
// ────────────────────────────────────────────────────────────────────

export type RevenueRow = { currency: string; amount: number; orders: number };
export type RevenueWindow = {
  last7d: RevenueRow[];
  last30d: RevenueRow[];
  allTime: RevenueRow[];
};

export async function loadRevenue(
  sql: NeonQueryFunction<false, false>,
): Promise<RevenueWindow> {
  // All three windows in one query — same shape, just different WHERE
  // clauses. We tag each row with the window so a single pass can split
  // them back out below.
  const rows = (await sql`
    SELECT '7d'::text AS window,
           COALESCE(currency, 'usd') AS currency,
           COALESCE(SUM(deposit_amount), 0)::bigint AS amount_minor,
           COUNT(*)::int AS orders
    FROM leads
    WHERE deposit_paid AND deposit_at > NOW() - INTERVAL '7 days'
    GROUP BY currency
    UNION ALL
    SELECT '30d'::text,
           COALESCE(currency, 'usd'),
           COALESCE(SUM(deposit_amount), 0)::bigint,
           COUNT(*)::int
    FROM leads
    WHERE deposit_paid AND deposit_at > NOW() - INTERVAL '30 days'
    GROUP BY currency
    UNION ALL
    SELECT 'all'::text,
           COALESCE(currency, 'usd'),
           COALESCE(SUM(deposit_amount), 0)::bigint,
           COUNT(*)::int
    FROM leads
    WHERE deposit_paid
    GROUP BY currency;
  `) as {
    window: "7d" | "30d" | "all";
    currency: string;
    amount_minor: string | number;
    orders: number;
  }[];

  const bucket = (w: "7d" | "30d" | "all"): RevenueRow[] =>
    rows
      .filter((r) => r.window === w)
      .map((r) => ({
        currency: r.currency,
        amount: Number(r.amount_minor) || 0,
        orders: Number(r.orders) || 0,
      }))
      .sort((a, b) => b.amount - a.amount);

  return {
    last7d: bucket("7d"),
    last30d: bucket("30d"),
    allTime: bucket("all"),
  };
}

export type Funnel30d = {
  waitlistSignups: number;
  checkoutsOpened: number;
  checkoutsPaid: number;
};

export async function loadFunnel30d(
  sql: NeonQueryFunction<false, false>,
): Promise<Funnel30d> {
  const [waitlistRow, openedRow, paidRow] = (await Promise.all([
    sql`
      SELECT COUNT(*)::int AS n FROM waitlist
      WHERE created_at > NOW() - INTERVAL '30 days';
    `,
    sql`
      SELECT COUNT(*)::int AS n FROM leads
      WHERE stripe_session_id IS NOT NULL
        AND updated_at > NOW() - INTERVAL '30 days';
    `,
    sql`
      SELECT COUNT(*)::int AS n FROM leads
      WHERE deposit_paid AND deposit_at > NOW() - INTERVAL '30 days';
    `,
  ])) as unknown as [{ n: number }[], { n: number }[], { n: number }[]];

  return {
    waitlistSignups: waitlistRow[0]?.n ?? 0,
    checkoutsOpened: openedRow[0]?.n ?? 0,
    checkoutsPaid: paidRow[0]?.n ?? 0,
  };
}

export type VariationAb = {
  variation: string;
  views: number;
  signups: number;
  paid: number;
};

export async function loadVariationAb30d(
  sql: NeonQueryFunction<false, false>,
): Promise<VariationAb[]> {
  // variation_views isn't time-bound (one row per visitor per variation,
  // ever), so the "30 days" window only constrains the signup/paid sides.
  // Views still reflect lifetime totals — called out in the UI footnote.
  const [viewRows, signupRows, paidRows] = (await Promise.all([
    sql`
      SELECT variation, COUNT(*)::int AS n
      FROM variation_views
      GROUP BY variation;
    `,
    sql`
      SELECT variation, COUNT(*)::int AS n
      FROM waitlist
      WHERE variation IS NOT NULL
        AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY variation;
    `,
    sql`
      SELECT variation, COUNT(*)::int AS n
      FROM leads
      WHERE variation IS NOT NULL
        AND deposit_paid
        AND deposit_at > NOW() - INTERVAL '30 days'
      GROUP BY variation;
    `,
  ])) as unknown as [
    { variation: string; n: number }[],
    { variation: string; n: number }[],
    { variation: string; n: number }[],
  ];

  const variations = new Set<string>();
  for (const r of viewRows) variations.add(r.variation);
  for (const r of signupRows) variations.add(r.variation);
  for (const r of paidRows) variations.add(r.variation);

  const views = new Map(viewRows.map((r) => [r.variation, Number(r.n)]));
  const signups = new Map(signupRows.map((r) => [r.variation, Number(r.n)]));
  const paid = new Map(paidRows.map((r) => [r.variation, Number(r.n)]));

  return Array.from(variations)
    .sort()
    .map((v) => ({
      variation: v,
      views: views.get(v) ?? 0,
      signups: signups.get(v) ?? 0,
      paid: paid.get(v) ?? 0,
    }));
}

export type RecentOrder = {
  email: string;
  deposit_amount: number;
  currency: string;
  deposit_at: string;
  shipping_country: string | null;
};

export async function loadRecentOrders(
  sql: NeonQueryFunction<false, false>,
): Promise<RecentOrder[]> {
  const rows = (await sql`
    SELECT email,
           deposit_amount,
           COALESCE(currency, 'usd') AS currency,
           deposit_at,
           shipping_country
    FROM leads
    WHERE deposit_paid
    ORDER BY deposit_at DESC NULLS LAST
    LIMIT 10;
  `) as {
    email: string;
    deposit_amount: number | null;
    currency: string;
    deposit_at: string | null;
    shipping_country: string | null;
  }[];
  return rows.map((r) => ({
    email: r.email,
    deposit_amount: Number(r.deposit_amount ?? 0),
    currency: r.currency,
    deposit_at: r.deposit_at ?? "",
    shipping_country: r.shipping_country,
  }));
}

export type RecentSignup = {
  email: string;
  variation: string | null;
  source: string | null;
  created_at: string;
};

export async function loadRecentSignups(
  sql: NeonQueryFunction<false, false>,
): Promise<RecentSignup[]> {
  const rows = (await sql`
    SELECT email, variation, source, created_at
    FROM waitlist
    ORDER BY created_at DESC
    LIMIT 10;
  `) as {
    email: string;
    variation: string | null;
    source: string | null;
    created_at: string;
  }[];
  return rows;
}

// ────────────────────────────────────────────────────────────────────
// Formatting helpers shared across the admin surfaces
// ────────────────────────────────────────────────────────────────────

// Stripe stores deposit_amount in minor units (cents). Convert to a
// human "$498" / "AU$249" string. Currency codes are lowercase ISO 4217.
const ZERO_DECIMAL = new Set(["jpy"]);
const CURRENCY_PREFIX: Record<string, string> = {
  usd: "$",
  cad: "CA$",
  aud: "AU$",
  nzd: "NZ$",
  sgd: "S$",
  gbp: "£",
  eur: "€",
  jpy: "¥",
};

export function formatMoney(amountMinor: number, currency: string): string {
  const cur = currency.toLowerCase();
  const prefix = CURRENCY_PREFIX[cur] ?? cur.toUpperCase() + " ";
  const major = ZERO_DECIMAL.has(cur) ? amountMinor : amountMinor / 100;
  // Drop trailing ".00" for cleaner display, keep cents otherwise.
  const formatted =
    major === Math.floor(major)
      ? major.toLocaleString("en-US", { maximumFractionDigits: 0 })
      : major.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  return `${prefix}${formatted}`;
}

// "a*****@ksso.net" — keep first char of local part, mask the rest,
// keep the domain. Two-char locals fall back to "a*".
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 1) return `${local}*${domain}`;
  return `${local[0]}${"*".repeat(Math.max(1, local.length - 1))}${domain}`;
}

// Relative time-ago without a dependency. "2m ago", "3h ago", "5d ago".
export function timeAgo(iso: string): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}
