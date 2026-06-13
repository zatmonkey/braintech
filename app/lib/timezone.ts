/**
 * IANA → POSIX TZ string mapping for OpenWrt's `uci system.@system[0].timezone`.
 *
 * OpenWrt routers don't carry the full zoneinfo binary database; they expect
 * the POSIX form (e.g. "PST8PDT,M3.2.0,M11.1.0") in UCI, and emit it as the
 * `TZ=` env var to anything that reads /etc/TZ. We keep `zonename` (the IANA
 * label) too so the UI can display "America/Los_Angeles" rather than the
 * unreadable POSIX blob.
 *
 * Curated to the timezones a household actually sits in. Anything not in this
 * table falls back to UTC — the agent still works, the daily-quota rollover
 * just happens at midnight UTC instead of local midnight.
 */

export const IANA_TO_POSIX: Record<string, string> = {
  // North America
  "America/Los_Angeles": "PST8PDT,M3.2.0,M11.1.0",
  "America/Vancouver": "PST8PDT,M3.2.0,M11.1.0",
  "America/Denver": "MST7MDT,M3.2.0,M11.1.0",
  "America/Phoenix": "MST7", // no DST
  "America/Chicago": "CST6CDT,M3.2.0,M11.1.0",
  "America/Mexico_City": "CST6",
  "America/New_York": "EST5EDT,M3.2.0,M11.1.0",
  "America/Toronto": "EST5EDT,M3.2.0,M11.1.0",
  "America/Anchorage": "AKST9AKDT,M3.2.0,M11.1.0",
  "Pacific/Honolulu": "HST10",

  // Europe
  "Europe/London": "GMT0BST,M3.5.0/1,M10.5.0",
  "Europe/Dublin": "GMT0IST,M3.5.0/1,M10.5.0",
  "Europe/Lisbon": "WET0WEST,M3.5.0/1,M10.5.0",
  "Europe/Paris": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Berlin": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Madrid": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Rome": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Amsterdam": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Brussels": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Stockholm": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Helsinki": "EET-2EEST,M3.5.0/3,M10.5.0/4",
  "Europe/Athens": "EET-2EEST,M3.5.0/3,M10.5.0/4",
  "Europe/Warsaw": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Moscow": "MSK-3",
  "Europe/Istanbul": "TRT-3",

  // Australia + NZ
  "Australia/Sydney": "AEST-10AEDT,M10.1.0,M4.1.0/3",
  "Australia/Melbourne": "AEST-10AEDT,M10.1.0,M4.1.0/3",
  "Australia/Brisbane": "AEST-10", // no DST
  "Australia/Adelaide": "ACST-9:30ACDT,M10.1.0,M4.1.0/3",
  "Australia/Perth": "AWST-8", // no DST
  "Australia/Hobart": "AEST-10AEDT,M10.1.0,M4.1.0/3",
  "Australia/Darwin": "ACST-9:30",
  "Pacific/Auckland": "NZST-12NZDT,M9.5.0,M4.1.0/3",

  // Asia
  "Asia/Tokyo": "JST-9",
  "Asia/Seoul": "KST-9",
  "Asia/Shanghai": "CST-8",
  "Asia/Hong_Kong": "HKT-8",
  "Asia/Singapore": "SGT-8",
  "Asia/Taipei": "CST-8",
  "Asia/Bangkok": "ICT-7",
  "Asia/Jakarta": "WIB-7",
  "Asia/Manila": "PHT-8",
  "Asia/Kolkata": "IST-5:30",
  "Asia/Dubai": "GST-4",
  "Asia/Tehran": "IRST-3:30",
  "Asia/Karachi": "PKT-5",

  // South America
  "America/Sao_Paulo": "BRT3",
  "America/Argentina/Buenos_Aires": "ART3",
  "America/Santiago": "CLT4CLST,M9.1.6/24,M4.1.6/24",
  "America/Lima": "PET5",
  "America/Bogota": "COT5",

  // Africa
  "Africa/Cairo": "EET-2",
  "Africa/Johannesburg": "SAST-2",
  "Africa/Lagos": "WAT-1",
  "Africa/Nairobi": "EAT-3",
  "Africa/Casablanca": "WET0WEST,M3.5.0,M10.5.0/3",

  // Fallback
  UTC: "UTC0",
};

/** Resolve an IANA timezone name to its POSIX TZ string. */
export function ianaToPosix(iana: string): string | null {
  return IANA_TO_POSIX[iana] ?? null;
}

/**
 * Coarse syntactic validation of an IANA name. We don't try to enumerate the
 * full tzdata catalogue — too churny and the lookup table above gates which
 * names actually do anything anyway. This just keeps obviously bad input
 * (script injection, control chars, absurd length) out of the DB.
 */
export function isPlausibleIanaName(s: string): boolean {
  if (!s || s.length > 64) return false;
  return /^[A-Za-z][A-Za-z0-9_+\-/]{1,63}$/.test(s);
}
