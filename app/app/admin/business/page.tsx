import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { verifySession, sessionCookie, isAdmin } from "@/app/lib/auth";
import {
  getSql,
  ensureSmsSchema,
  ensureVariationSchema,
} from "@/app/lib/db";
import {
  loadRevenue,
  loadFunnel30d,
  loadVariationAb30d,
  loadRecentOrders,
  loadRecentSignups,
  formatMoney,
  maskEmail,
  timeAgo,
  type RevenueRow,
  type VariationAb,
  type RecentOrder,
  type RecentSignup,
  type Funnel30d,
} from "@/app/lib/admin-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  title: "Business · Braintech admin",
  robots: { index: false, follow: false },
};

export default async function BusinessAdmin() {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) redirect("/login?from=/admin/business");
  if (!isAdmin(email)) redirect("/app");

  const sql = getSql();
  if (!sql) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <p className="text-[var(--color-ink-soft)]">Database unavailable.</p>
      </main>
    );
  }
  await ensureSmsSchema(sql);
  await ensureVariationSchema(sql);

  const [revenue, funnel, ab, orders, signups] = await Promise.all([
    loadRevenue(sql),
    loadFunnel30d(sql),
    loadVariationAb30d(sql),
    loadRecentOrders(sql),
    loadRecentSignups(sql),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 sm:py-14">
      <header className="mb-8">
        <Link
          href="/app/admin"
          className="text-xs uppercase tracking-wider text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
        >
          ← Admin
        </Link>
        <h1 className="serif mt-2 text-3xl tracking-tight sm:text-4xl">
          Business
        </h1>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          Revenue, conversion funnel, A/B by variation. Read-only.
        </p>
      </header>

      <div className="space-y-10">
        <RevenueSection
          last7d={revenue.last7d}
          last30d={revenue.last30d}
          allTime={revenue.allTime}
        />

        <FunnelSection funnel={funnel} />

        <AbSection rows={ab} />

        <RecentOrdersSection rows={orders} />

        <RecentSignupsSection rows={signups} />
      </div>
    </main>
  );
}

// ────────────────────────────────────────────────────────────────────
// Revenue
// ────────────────────────────────────────────────────────────────────

function RevenueSection({
  last7d,
  last30d,
  allTime,
}: {
  last7d: RevenueRow[];
  last30d: RevenueRow[];
  allTime: RevenueRow[];
}) {
  return (
    <section>
      <h2 className="serif text-2xl tracking-[-0.01em]">Revenue</h2>
      <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
        Sum of paid deposits. Grouped by currency where the lead was billed.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <RevenueCard label="Last 7 days" rows={last7d} />
        <RevenueCard label="Last 30 days" rows={last30d} />
        <RevenueCard label="All time" rows={allTime} />
      </div>
    </section>
  );
}

function RevenueCard({ label, rows }: { label: string; rows: RevenueRow[] }) {
  const totalOrders = rows.reduce((acc, r) => acc + r.orders, 0);
  return (
    <div className="rounded-2xl border border-[var(--color-rule)] bg-white p-4">
      <dt className="text-xs uppercase tracking-wider text-[var(--color-ink-soft)]">
        {label}
      </dt>
      <dd className="mt-2 space-y-1">
        {rows.length === 0 ? (
          <p className="font-mono text-lg text-[var(--color-ink)]">$0</p>
        ) : (
          rows.map((r) => (
            <p
              key={r.currency}
              className="flex items-baseline justify-between gap-2"
            >
              <span className="font-mono text-lg text-[var(--color-ink)]">
                {formatMoney(r.amount, r.currency)}
              </span>
              <span className="text-xs text-[var(--color-ink-soft)]">
                {r.orders} order{r.orders === 1 ? "" : "s"}
              </span>
            </p>
          ))
        )}
        {rows.length > 1 && (
          <p className="border-t border-[var(--color-rule)] pt-1 text-xs text-[var(--color-ink-soft)]">
            {totalOrders} total order{totalOrders === 1 ? "" : "s"}
          </p>
        )}
      </dd>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Funnel
// ────────────────────────────────────────────────────────────────────

function FunnelSection({ funnel }: { funnel: Funnel30d }) {
  // Rates: signups→opened, opened→paid. We show both step-on-step and
  // top-of-funnel-to-step so it's possible to spot a leaky middle.
  const step1Pct =
    funnel.waitlistSignups === 0
      ? 0
      : (funnel.checkoutsOpened / funnel.waitlistSignups) * 100;
  const step2Pct =
    funnel.checkoutsOpened === 0
      ? 0
      : (funnel.checkoutsPaid / funnel.checkoutsOpened) * 100;
  const overallPct =
    funnel.waitlistSignups === 0
      ? 0
      : (funnel.checkoutsPaid / funnel.waitlistSignups) * 100;

  return (
    <section>
      <h2 className="serif text-2xl tracking-[-0.01em]">
        Conversion funnel · last 30d
      </h2>
      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--color-rule)] bg-white">
        <FunnelStep
          label="Waitlist signups"
          value={funnel.waitlistSignups}
          conversion={null}
        />
        <FunnelStep
          label="Checkouts opened"
          value={funnel.checkoutsOpened}
          conversion={
            funnel.waitlistSignups === 0
              ? null
              : `${step1Pct.toFixed(1)}% of signups`
          }
        />
        <FunnelStep
          label="Checkouts paid"
          value={funnel.checkoutsPaid}
          conversion={
            funnel.checkoutsOpened === 0
              ? null
              : `${step2Pct.toFixed(1)}% of opened`
          }
          isLast
        />
      </div>
      {funnel.waitlistSignups > 0 && (
        <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
          End-to-end: {overallPct.toFixed(1)}% signups → paid.
        </p>
      )}
    </section>
  );
}

function FunnelStep({
  label,
  value,
  conversion,
  isLast = false,
}: {
  label: string;
  value: number;
  conversion: string | null;
  isLast?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 px-4 py-3 sm:px-5 ${
        isLast ? "" : "border-b border-[var(--color-rule)]"
      }`}
    >
      <div>
        <p className="text-sm font-medium text-[var(--color-ink)]">{label}</p>
        {conversion && (
          <p className="text-xs text-[var(--color-ink-soft)]">{conversion}</p>
        )}
      </div>
      <span className="font-mono text-2xl text-[var(--color-ink)]">
        {value}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// A/B
// ────────────────────────────────────────────────────────────────────

function AbSection({ rows }: { rows: VariationAb[] }) {
  return (
    <section>
      <h2 className="serif text-2xl tracking-[-0.01em]">
        Per-variation A/B · last 30d
      </h2>
      <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
        Note: views are lifetime (variation_views is not date-stamped per
        visitor); signups and paid count only the last 30 days.
      </p>
      {rows.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-[var(--color-rule)] bg-[var(--color-cream)] p-6 text-center text-sm text-[var(--color-ink-soft)]">
          No variation data yet.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--color-rule)] bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-rule)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-soft)]">
                <th className="px-4 py-2">Variation</th>
                <th className="px-3 py-2 text-right">Views</th>
                <th className="px-3 py-2 text-right">Signups</th>
                <th className="px-3 py-2 text-right">Sign-up rate</th>
                <th className="px-3 py-2 text-right">Paid</th>
                <th className="px-3 py-2 text-right">Paid rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const signupRate =
                  r.views === 0 ? 0 : (r.signups / r.views) * 100;
                const paidRate = r.views === 0 ? 0 : (r.paid / r.views) * 100;
                return (
                  <tr
                    key={r.variation}
                    className="border-b border-[var(--color-rule)] last:border-b-0"
                  >
                    <td className="px-4 py-2 font-mono text-xs">
                      v{r.variation}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.views}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.signups}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-[var(--color-ink-soft)]">
                      {r.views === 0 ? "—" : `${signupRate.toFixed(1)}%`}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.paid}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-[var(--color-ink-soft)]">
                      {r.views === 0 ? "—" : `${paidRate.toFixed(2)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Recent orders
// ────────────────────────────────────────────────────────────────────

function RecentOrdersSection({ rows }: { rows: RecentOrder[] }) {
  return (
    <section>
      <h2 className="serif text-2xl tracking-[-0.01em]">Recent orders</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
          No paid orders yet.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-[var(--color-rule)] bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-rule)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-soft)]">
                <th className="px-4 py-2">Email</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Country</th>
                <th className="px-3 py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.email}-${i}`}
                  className="border-b border-[var(--color-rule)] last:border-b-0"
                >
                  <td className="px-4 py-2 font-mono text-xs text-[var(--color-ink)]">
                    {maskEmail(r.email)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatMoney(r.deposit_amount, r.currency)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.shipping_country ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--color-ink-soft)]">
                    {timeAgo(r.deposit_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Recent signups
// ────────────────────────────────────────────────────────────────────

function RecentSignupsSection({ rows }: { rows: RecentSignup[] }) {
  return (
    <section>
      <h2 className="serif text-2xl tracking-[-0.01em]">Recent signups</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
          No waitlist signups yet.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-[var(--color-rule)] bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-rule)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-soft)]">
                <th className="px-4 py-2">Email</th>
                <th className="px-3 py-2">Variation</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.email}-${i}`}
                  className="border-b border-[var(--color-rule)] last:border-b-0"
                >
                  <td className="px-4 py-2 font-mono text-xs text-[var(--color-ink)]">
                    {maskEmail(r.email)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.variation ? `v${r.variation}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--color-ink-soft)]">
                    {r.source ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--color-ink-soft)]">
                    {timeAgo(r.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
