/**
 * Per-country marketing pricing for the founding device.
 *
 * Prices are hand-tuned for charm pricing in each currency — they're NOT
 * a live FX conversion. The whole point is that AU$79 feels right to an
 * Australian and £39 feels right to a Brit; an autoconverted "$73.42" does
 * not. We accept margin variance across regions in exchange for clean copy.
 *
 * Stripe accepts amounts in the smallest unit of the currency
 * (cents/pence/yen), so each entry stores `*Cents`. JPY has no minor unit;
 * `*Cents` for JPY is the same as the whole amount, which is correct for
 * Stripe (Stripe treats zero-decimal currencies specially — see
 * https://docs.stripe.com/currencies#zero-decimal).
 *
 * Anything we don't have a mapping for falls back to USD.
 */

export type CurrencyCode =
  | "USD"
  | "AUD"
  | "GBP"
  | "EUR"
  | "CAD"
  | "NZD"
  | "SGD"
  | "JPY";

export type Pricing = {
  currency: CurrencyCode;
  // ISO country code we matched on (for analytics / debugging).
  country: string;
  // Marketing labels — these are what users see.
  depositLabel: string; // e.g. "$50", "AU$79", "£39"
  purchaseLabel: string; // e.g. "$249/yr", "AU$379/yr"
  // The deposit amount written as a sentence-friendly phrase.
  depositPhrase: string; // "$50 deposit", "AU$79 deposit"
  // Raw cents / minor units, what Stripe gets.
  depositMinor: number;
  purchaseMinor: number;
};

type Entry = Omit<Pricing, "country"> & { countries: readonly string[] };

const TABLE: readonly Entry[] = [
  {
    countries: ["AU"],
    currency: "AUD",
    depositLabel: "AU$79",
    purchaseLabel: "AU$379/yr",
    depositPhrase: "AU$79 deposit",
    depositMinor: 7900,
    purchaseMinor: 37900,
  },
  {
    countries: ["NZ"],
    currency: "NZD",
    depositLabel: "NZ$79",
    purchaseLabel: "NZ$399/yr",
    depositPhrase: "NZ$79 deposit",
    depositMinor: 7900,
    purchaseMinor: 39900,
  },
  {
    countries: ["GB", "IE"],
    currency: "GBP",
    depositLabel: "£39",
    purchaseLabel: "£199/yr",
    depositPhrase: "£39 deposit",
    depositMinor: 3900,
    purchaseMinor: 19900,
  },
  {
    countries: ["CA"],
    currency: "CAD",
    depositLabel: "CA$69",
    purchaseLabel: "CA$339/yr",
    depositPhrase: "CA$69 deposit",
    depositMinor: 6900,
    purchaseMinor: 33900,
  },
  {
    // The euro block — pricing identical across the Eurozone for simplicity.
    countries: [
      "FR", "DE", "ES", "IT", "NL", "BE", "AT", "PT", "FI", "GR",
      "IE", // also a euro country in addition to its GBP listing above
    ],
    currency: "EUR",
    depositLabel: "€49",
    purchaseLabel: "€229/yr",
    depositPhrase: "€49 deposit",
    depositMinor: 4900,
    purchaseMinor: 22900,
  },
  {
    countries: ["SG"],
    currency: "SGD",
    depositLabel: "S$69",
    purchaseLabel: "S$329/yr",
    depositPhrase: "S$69 deposit",
    depositMinor: 6900,
    purchaseMinor: 32900,
  },
  {
    countries: ["JP"],
    currency: "JPY",
    depositLabel: "¥7,500",
    purchaseLabel: "¥37,800/yr",
    depositPhrase: "¥7,500 deposit",
    // JPY is zero-decimal in Stripe — minor units == major units.
    depositMinor: 7500,
    purchaseMinor: 37800,
  },
];

const USD_PRICING: Omit<Pricing, "country"> = {
  currency: "USD",
  depositLabel: "$50",
  purchaseLabel: "$249/yr",
  depositPhrase: "$50 deposit",
  depositMinor: 5000,
  purchaseMinor: 24900,
};

// Currency → display prefix (USD: "$", AUD: "AU$", JPY: "¥", …). Used when
// an env-var override changes an amount and we need to re-render the label.
const PREFIX: Record<CurrencyCode, string> = {
  USD: "$",
  AUD: "AU$",
  NZD: "NZ$",
  GBP: "£",
  EUR: "€",
  CAD: "CA$",
  SGD: "S$",
  JPY: "¥",
};

// JPY is zero-decimal in Stripe; everything else uses 2 minor units per
// major. https://docs.stripe.com/currencies#zero-decimal
function majorToMinor(currency: CurrencyCode, major: number): number {
  return currency === "JPY" ? major : major * 100;
}
function formatMajor(currency: CurrencyCode, major: number): string {
  if (currency === "JPY") return `${PREFIX.JPY}${major.toLocaleString("en-US")}`;
  return `${PREFIX[currency]}${major}`;
}

/**
 * Read an env-var override of the form `BT_PRICE_<CURRENCY>_<KIND>`, where
 * CURRENCY is USD/AUD/… and KIND is DEPOSIT or PURCHASE. The value is the
 * MAJOR-unit amount (e.g. `79` for AU$79, `7500` for ¥7,500) so it's easy to
 * eyeball in the Vercel dashboard without thinking in cents.
 *
 *   BT_PRICE_AUD_DEPOSIT=89
 *   BT_PRICE_AUD_PURCHASE=399
 *
 * Returns null if unset or malformed (so the default applies).
 */
function envOverride(
  currency: CurrencyCode,
  kind: "DEPOSIT" | "PURCHASE",
): number | null {
  const raw = process.env[`BT_PRICE_${currency}_${kind}`];
  if (!raw) return null;
  const n = parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Apply any env-var overrides for this Pricing entry. Idempotent — passing
 * an already-overridden entry through again is a no-op (the override values
 * are the same).
 */
function applyOverrides(
  entry: Omit<Pricing, "country">,
): Omit<Pricing, "country"> {
  const depositOverride = envOverride(entry.currency, "DEPOSIT");
  const purchaseOverride = envOverride(entry.currency, "PURCHASE");
  if (depositOverride === null && purchaseOverride === null) return entry;

  const next = { ...entry };
  if (depositOverride !== null) {
    const minor = majorToMinor(entry.currency, depositOverride);
    const label = formatMajor(entry.currency, depositOverride);
    next.depositMinor = minor;
    next.depositLabel = label;
    next.depositPhrase = `${label} deposit`;
  }
  if (purchaseOverride !== null) {
    next.purchaseMinor = majorToMinor(entry.currency, purchaseOverride);
    next.purchaseLabel = `${formatMajor(entry.currency, purchaseOverride)}/yr`;
  }
  return next;
}

/**
 * Given an ISO country code (e.g. "AU", "GB"), return the marketing pricing.
 * Falls back to USD if we don't have a mapping. Resolves IE → EUR for the
 * Eurozone (the GB/IE row is only matched when picked first; we prefer the
 * EUR mapping for IE because Ireland is euro).
 */
export function pricingForCountry(country: string | null | undefined): Pricing {
  const c = (country ?? "").toUpperCase();

  // IE special-case: prefer EUR over the GB row (Ireland is Eurozone).
  if (c === "IE") {
    const eur = TABLE.find((e) => e.currency === "EUR");
    if (eur) return { ...applyOverrides(eur), country: c };
  }

  const match = TABLE.find((e) => e.countries.includes(c));
  if (match) return { ...applyOverrides(match), country: c };
  return { ...applyOverrides(USD_PRICING), country: c || "US" };
}

/**
 * The minor-unit count that the Stripe `unit_amount` field expects. This
 * exists so the checkout route can compute the amount without re-importing
 * the whole pricing object. Both `mode`s mapped explicitly so a typo in the
 * caller fails loudly.
 */
/**
 * Currencies the picker offers. Each entry has the primary country code we
 * write to bt_geo when the visitor picks it (e.g. picking EUR sets country
 * to "FR" — pricingForCountry will resolve that to the EUR row).
 */
export const PICKER_CURRENCIES: ReadonlyArray<{
  currency: CurrencyCode;
  country: string;
  label: string; // shown in the <select>
}> = [
  { currency: "USD", country: "US", label: "USD ($)" },
  { currency: "AUD", country: "AU", label: "AUD (AU$)" },
  { currency: "GBP", country: "GB", label: "GBP (£)" },
  { currency: "EUR", country: "FR", label: "EUR (€)" },
  { currency: "CAD", country: "CA", label: "CAD (CA$)" },
  { currency: "NZD", country: "NZ", label: "NZD (NZ$)" },
  { currency: "SGD", country: "SG", label: "SGD (S$)" },
  { currency: "JPY", country: "JP", label: "JPY (¥)" },
];

export function stripeAmount(
  pricing: Pricing,
  mode: "deposit" | "purchase",
): { amount: number; currency: string } {
  return {
    amount: mode === "purchase" ? pricing.purchaseMinor : pricing.depositMinor,
    currency: pricing.currency.toLowerCase(),
  };
}
