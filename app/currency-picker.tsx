"use client";

/**
 * Small currency selector for the footer. Lets visitors override our
 * IP-geo detection — useful for VPN users, expats shopping in their home
 * currency, or anyone whose carrier hop lies about their country.
 *
 * UX: the dropdown writes the visitor's choice to the `bt_geo` cookie
 * (same one proxy.ts auto-stamps) and reloads the page so the server
 * re-computes Pricing from the new country. No optimistic UI — pricing
 * comes from the server and we'd rather one round-trip than the wrong
 * number flashing on screen.
 *
 * `currentCountry` is read server-side and passed in so the initial
 * selected value matches the prices currently rendered above.
 */

import { useEffect, useRef, useState } from "react";
import { sendGAEvent } from "@next/third-parties/google";
import { PICKER_CURRENCIES, type CurrencyCode } from "./lib/pricing";

// Map an arbitrary country code (e.g. "DE") to the currency we'd render for
// it (EUR) so we can pre-select the right option even when the visitor is
// in a country that isn't itself a picker option.
function countryToPickerCountry(
  country: string,
): { currency: CurrencyCode; country: string } {
  const c = (country || "").toUpperCase();
  // Direct hit.
  const direct = PICKER_CURRENCIES.find((p) => p.country === c);
  if (direct) return direct;
  // Eurozone fall-back — anything that's not in the direct list but lives in
  // a euro country routes to the EUR row.
  const eur = ["FR", "DE", "ES", "IT", "NL", "BE", "AT", "PT", "FI", "GR", "IE"];
  if (eur.includes(c)) {
    const e = PICKER_CURRENCIES.find((p) => p.currency === "EUR");
    if (e) return e;
  }
  return PICKER_CURRENCIES[0]; // USD
}

export function CurrencyPicker({ currentCountry }: { currentCountry: string }) {
  const initial = countryToPickerCountry(currentCountry);
  const [country, setCountry] = useState(initial.country);
  const initialRef = useRef(initial.country);

  // The server may have rendered with a different country than the cookie
  // says (e.g. the first request had no cookie yet). Reconcile after mount.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const match = document.cookie.match(/(?:^|;\s*)bt_geo=([A-Za-z]{2})/);
    if (match) {
      const resolved = countryToPickerCountry(match[1].toUpperCase()).country;
      if (resolved !== country) setCountry(resolved);
      initialRef.current = resolved;
    }
  }, []); // intentionally once on mount

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (next === initialRef.current) return;
    setCountry(next);
    // 30 days — same TTL as proxy.ts.
    document.cookie = `bt_geo=${next}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=lax; Secure`;
    sendGAEvent("event", "currency_picker", {
      from: initialRef.current,
      to: next,
    });
    // Server re-renders pricing on reload.
    window.location.reload();
  }

  return (
    <label className="inline-flex items-center gap-2 text-xs text-[var(--color-cream)]/60">
      <span>Currency:</span>
      <select
        value={country}
        onChange={onChange}
        aria-label="Choose your currency"
        className="rounded-md border border-white/15 bg-transparent px-2 py-1 text-xs text-[var(--color-cream)] outline-none transition hover:border-white/30 focus:border-white/40"
      >
        {PICKER_CURRENCIES.map((p) => (
          <option key={p.currency} value={p.country} className="bg-[var(--color-night)] text-[var(--color-cream)]">
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}
