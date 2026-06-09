/**
 * Founding-batch config. Two values that drive the scarcity messaging
 * everywhere on /, /start, and any future post-Lead emails.
 *
 * Updating these here updates the hero, the pricing section, the
 * thank-you state, and the FAQ in one shot.
 *
 *   FOUNDING_BATCH_N    – the batch number we're currently selling
 *   FOUNDING_BATCH_SHIPS – human-readable ship month ("August", "Sept",
 *                         "Q4 2026"; whatever reads honestly today)
 *   FOUNDING_SPOTS_LEFT  – how many founding spots remain in the
 *                         currently-selling batch.
 *
 * Env-var overrides let us bump the spots-remaining without a deploy
 * once the campaign is live (e.g. via Vercel env vars).
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function envStr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.trim().length ? raw.trim() : fallback;
}

export const FOUNDING_BATCH_N = envInt("BT_FOUNDING_BATCH_N", 1);
export const FOUNDING_BATCH_SHIPS = envStr("BT_FOUNDING_BATCH_SHIPS", "August");
export const FOUNDING_SPOTS_LEFT = envInt("BT_FOUNDING_SPOTS_LEFT", 312);

/**
 * Short marketing label, e.g. "Founding batch #1 ships August — 312 spots left."
 */
export function foundingScarcity(): string {
  return `Founding batch #${FOUNDING_BATCH_N} ships ${FOUNDING_BATCH_SHIPS} — ${FOUNDING_SPOTS_LEFT} spots left.`;
}

/**
 * Short ship-date label for use in confirmation/thank-you state.
 */
export function foundingShipMonth(): string {
  return `Founding batch ships in ${FOUNDING_BATCH_SHIPS}.`;
}
