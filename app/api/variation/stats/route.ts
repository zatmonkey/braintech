// Per-variation conversion stats. Session-authed: any signed-in account
// can read it (in practice that's just the founder — the auth surface for
// /app today is a single-tenant login). Used by `btnet variations` to print
// a table at the terminal.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import { getSql, ensureSmsSchema, ensureVariationSchema } from "@/app/lib/db";
import { VARIATIONS } from "@/app/variations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  mode: "waitlist" | "buyNow";
  views: number;
  signups: number; // unique waitlist emails
  deposits: number; // checkout_mode='deposit' AND deposit_paid
  purchases: number; // checkout_mode='purchase' AND deposit_paid
  signupRate: number; // signups / views
  paidRate: number; // (deposits + purchases) / views
};

export async function GET() {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ error: "db unavailable" }, { status: 503 });
  }

  await ensureSmsSchema(sql);
  await ensureVariationSchema(sql);

  // Pull all three counters in parallel.
  const [viewRows, signupRows, leadRows] = (await Promise.all([
    sql`
      SELECT variation, COUNT(*)::int AS n
        FROM variation_views
       GROUP BY variation;
    `,
    sql`
      SELECT variation, COUNT(*)::int AS n
        FROM waitlist
       WHERE variation IS NOT NULL
       GROUP BY variation;
    `,
    sql`
      SELECT variation,
             COUNT(*) FILTER (WHERE deposit_paid AND checkout_mode = 'deposit')::int   AS deposits,
             COUNT(*) FILTER (WHERE deposit_paid AND checkout_mode = 'purchase')::int  AS purchases
        FROM leads
       WHERE variation IS NOT NULL
       GROUP BY variation;
    `,
  ])) as unknown as [
    { variation: string; n: number }[],
    { variation: string; n: number }[],
    { variation: string; deposits: number; purchases: number }[],
  ];

  const views = new Map(viewRows.map((r) => [r.variation, r.n]));
  const signups = new Map(signupRows.map((r) => [r.variation, r.n]));
  const leads = new Map(leadRows.map((r) => [r.variation, r]));

  const rows: Row[] = VARIATIONS.map((v) => {
    const n = views.get(v.id) ?? 0;
    const s = signups.get(v.id) ?? 0;
    const l = leads.get(v.id);
    const d = l?.deposits ?? 0;
    const p = l?.purchases ?? 0;
    return {
      id: v.id,
      mode: v.mode,
      views: n,
      signups: s,
      deposits: d,
      purchases: p,
      signupRate: n > 0 ? s / n : 0,
      paidRate: n > 0 ? (d + p) / n : 0,
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      views: acc.views + r.views,
      signups: acc.signups + r.signups,
      deposits: acc.deposits + r.deposits,
      purchases: acc.purchases + r.purchases,
    }),
    { views: 0, signups: 0, deposits: 0, purchases: 0 },
  );

  return NextResponse.json({ rows, totals });
}
