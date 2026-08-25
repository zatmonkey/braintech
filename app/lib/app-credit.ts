/**
 * Per-app earned bonus minutes. "Maya earned 20 min of Netflix" grants a
 * weekly, app-specific allowance that the on-device engine lets her spend
 * only inside a schedule rule's window and only after the general quota is
 * gone. Distinct from brain_credits (app-agnostic general credit).
 *
 * The canonical app key must equal the lowercased name the agent's
 * classifyApp() returns for that app's domains (usage.go), or the device
 * can't match a queried domain to its bonus. normalizeAppKey maps the
 * words a parent/Bri would use onto those keys.
 */
import type { NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

// input phrase → canonical key (= lowercase classifyApp name on the agent).
const APP_KEY_ALIASES: Record<string, string> = {
  netflix: "netflix",
  roblox: "roblox",
  youtube: "youtube", yt: "youtube",
  disney: "disney+", "disney+": "disney+", disneyplus: "disney+", "disney plus": "disney+",
  hulu: "hulu",
  prime: "prime video", "prime video": "prime video", "amazon prime": "prime video",
  hbo: "hbo max", max: "hbo max", "hbo max": "hbo max", hbomax: "hbo max",
  fortnite: "fortnite",
  minecraft: "minecraft",
  steam: "steam",
  discord: "discord",
  instagram: "instagram", ig: "instagram", insta: "instagram",
  tiktok: "tiktok", tt: "tiktok",
  snapchat: "snapchat", snap: "snapchat",
  reddit: "reddit",
  twitch: "twitch",
  x: "x", twitter: "x",
};

/** Returns the canonical app key for a parent-supplied name, or null. */
export function normalizeAppKey(name: string): string | null {
  const k = name.trim().toLowerCase();
  return APP_KEY_ALIASES[k] ?? null;
}

export async function grantAppCredit(
  sql: Sql,
  email: string,
  mac: string,
  appKey: string,
  minutes: number,
): Promise<number> {
  const rows = (await sql`
    INSERT INTO brain_app_credits (owner_email, mac, app, balance_minutes)
    VALUES (${email}, ${mac.toLowerCase()}, ${appKey}, ${minutes})
    ON CONFLICT (owner_email, mac, app) DO UPDATE
      SET balance_minutes = brain_app_credits.balance_minutes + ${minutes},
          updated_at = NOW()
    RETURNING balance_minutes;
  `) as { balance_minutes: number }[];
  return Number(rows[0]?.balance_minutes ?? minutes);
}

/**
 * Per-app bonus balances for a set of MACs, as {mac: {appKey: minutes}}.
 * Embedded in each schedule rule's policy doc so the device knows the
 * weekly per-app allowance to grant on top of the general quota.
 */
export async function loadAppCreditsByMac(
  sql: Sql,
  email: string,
  macs: string[],
): Promise<Record<string, Record<string, number>>> {
  if (macs.length === 0) return {};
  const rows = (await sql`
    SELECT LOWER(mac) AS mac, app, balance_minutes
    FROM brain_app_credits
    WHERE owner_email = ${email}
      AND LOWER(mac) = ANY(${macs.map((m) => m.toLowerCase())}::text[])
      AND balance_minutes > 0;
  `) as { mac: string; app: string; balance_minutes: number }[];
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    (out[r.mac] ??= {})[r.app] = Number(r.balance_minutes);
  }
  return out;
}
