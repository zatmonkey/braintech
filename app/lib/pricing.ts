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
    if (eur) return { ...eur, country: c };
  }

  const match = TABLE.find((e) => e.countries.includes(c));
  if (match) return { ...match, country: c };
  return { ...USD_PRICING, country: c || "US" };
}

/**
 * The minor-unit count that the Stripe `unit_amount` field expects. This
 * exists so the checkout route can compute the amount without re-importing
 * the whole pricing object. Both `mode`s mapped explicitly so a typo in the
 * caller fails loudly.
 */
export function stripeAmount(
  pricing: Pricing,
  mode: "deposit" | "purchase",
): { amount: number; currency: string } {
  return {
    amount: mode === "purchase" ? pricing.purchaseMinor : pricing.depositMinor,
    currency: pricing.currency.toLowerCase(),
  };
}
