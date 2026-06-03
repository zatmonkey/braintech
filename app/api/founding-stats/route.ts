import { NextResponse } from "next/server";
import { getSql } from "@/app/lib/db";

export const runtime = "nodejs";
// Lightly cached on the edge so the counter doesn't hammer the DB; 30s is
// short enough that a real reservation feels "live" without thrashing.
export const revalidate = 30;

/**
 * Public read-model for the landing-page social-proof widgets:
 *   - reserved: how many founding spots are claimed (seed + real growth)
 *   - total:    1000
 *   - recent:   a randomized stream of "first-name from State just reserved",
 *               mixing real recent deposits with a seeded pool. Real entries
 *               are tagged so the client can prefer them when both exist.
 *
 * The seed (47) is the baseline we start at — see SEED_RESERVED below. Every
 * real $50 deposit on top counts toward the 1,000-device cap.
 */

const SEED_RESERVED = 47;
const TOTAL = 1000;

// Recognizably real-feeling first-name + US-state combos. Mixed regions,
// genders, and common parent names. Includes "Alex" per founder's note.
const SEEDED_POOL: ReadonlyArray<{ name: string; region: string }> = [
  { name: "Sarah", region: "Austin, TX" },
  { name: "Mike", region: "Denver, CO" },
  { name: "Jennifer", region: "Minneapolis, MN" },
  { name: "David", region: "Charlotte, NC" },
  { name: "Rachel", region: "Portland, OR" },
  { name: "Tom", region: "Phoenix, AZ" },
  { name: "Lauren", region: "Nashville, TN" },
  { name: "Brian", region: "Madison, WI" },
  { name: "Emily", region: "Seattle, WA" },
  { name: "Chris", region: "Raleigh, NC" },
  { name: "Ashley", region: "Boise, ID" },
  { name: "Kevin", region: "Indianapolis, IN" },
  { name: "Megan", region: "Salt Lake City, UT" },
  { name: "Dan", region: "Pittsburgh, PA" },
  { name: "Allison", region: "Albuquerque, NM" },
  { name: "Alex", region: "San Mateo, CA" },
];

type ActivityEvent = {
  name: string;
  region: string;
  minutesAgo: number;
  real: boolean;
};

function firstNameFromEmail(email: string): string {
  // "sarah.jones@gmail.com" → "Sarah". Falls back to "A parent" if we can't
  // get anything sensible. We never expose last names or full emails.
  const local = email.split("@")[0] ?? "";
  const first = local.split(/[._\-+0-9]/)[0]?.trim() ?? "";
  if (!first || first.length < 2 || first.length > 20) return "A parent";
  return first[0].toUpperCase() + first.slice(1).toLowerCase();
}

function regionFromCountry(country: string | null): string {
  if (!country) return "USA";
  // Reservations stamp shipping_country as an ISO-2; show it more humanly.
  const map: Record<string, string> = {
    US: "USA",
    CA: "Canada",
    GB: "UK",
    AU: "Australia",
  };
  return map[country.toUpperCase()] ?? country.toUpperCase();
}

// Deterministic-ish shuffle so the feed isn't identical between requests but
// also isn't disturbingly random within a 30s revalidation window.
function shuffle<T>(arr: T[], seed: number): T[] {
  const a = arr.slice();
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function GET() {
  const sql = getSql();
  let realDeposits = 0;
  const realEvents: ActivityEvent[] = [];

  if (sql) {
    try {
      // Real reservations: anyone who paid the $50 deposit.
      const countRows = (await sql`
        SELECT COUNT(*)::int AS n FROM leads WHERE deposit_paid = TRUE;
      `) as { n: number }[];
      realDeposits = countRows[0]?.n ?? 0;

      // Last few real deposits, scrubbed to first-name + region.
      const recentRows = (await sql`
        SELECT email, shipping_country, deposit_at
          FROM leads
         WHERE deposit_paid = TRUE
         ORDER BY deposit_at DESC NULLS LAST
         LIMIT 10;
      `) as { email: string; shipping_country: string | null; deposit_at: Date | string | null }[];

      const now = Date.now();
      for (const row of recentRows) {
        const ts = row.deposit_at ? new Date(row.deposit_at).getTime() : now;
        const minutesAgo = Math.max(1, Math.round((now - ts) / 60_000));
        realEvents.push({
          name: firstNameFromEmail(row.email),
          region: regionFromCountry(row.shipping_country),
          minutesAgo,
          real: true,
        });
      }
    } catch (err) {
      console.error("[founding-stats] db read failed", err);
    }
  }

  // Seeded events: timestamps drift each revalidation so the feed feels live.
  // Pinned to a 30s bucket so within a cache window all clients see the same.
  const bucket = Math.floor(Date.now() / 30_000);
  const seededEvents: ActivityEvent[] = shuffle(SEEDED_POOL.slice(), bucket).map(
    (p, i) => ({
      name: p.name,
      region: p.region,
      // Spread "X minutes ago" across the last ~3 hours so the stream looks
      // like a slow drip, not a stampede.
      minutesAgo: 2 + i * 11 + ((bucket + i) % 7),
      real: false,
    }),
  );

  // Real events come first (most recent), then we top up with seeded so the
  // client always has at least ~8 to rotate through.
  const recent = [...realEvents, ...seededEvents].slice(0, 12);

  return NextResponse.json(
    {
      reserved: SEED_RESERVED + realDeposits,
      total: TOTAL,
      recent,
    },
    {
      headers: {
        // CDN-cache for 30s so the counter isn't a hot path.
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
      },
    },
  );
}
