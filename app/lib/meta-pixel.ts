/**
 * Browser-side Meta Pixel helpers — advanced matching + safe fbq wrapper.
 *
 * Pattern: hash the email client-side with SHA-256, push it as user_data
 * to the pixel via the AAM (Automatic / Advanced Matching) layer, then
 * fire the Lead event. The hashed em + the optional country + the
 * client_user_agent give Meta enough to match the event to a Facebook
 * user even if cookies are blocked.
 *
 * https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
 */

const PIXEL_ID = "1308736174041664";

type FbqFn = (...args: unknown[]) => void;
function fbq(): FbqFn | null {
  const w = window as typeof window & { fbq?: FbqFn };
  return typeof w.fbq === "function" ? w.fbq : null;
}

/**
 * SHA-256 the input. Meta wants the email lowercased + trimmed, then
 * hex-digested.
 */
export async function sha256Lower(input: string): Promise<string> {
  const data = new TextEncoder().encode(input.trim().toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(buf));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Re-init the pixel with advanced-matching user_data. This is the
 * Meta-recommended way to attach hashed PII to subsequent events. After
 * this call, fbq('track','Lead') will carry the user data.
 */
export async function setAdvancedMatching(opts: {
  email?: string | null;
  phone?: string | null;
  country?: string | null;
}): Promise<void> {
  const f = fbq();
  if (!f) return;
  const data: Record<string, string> = {};
  if (opts.email) data.em = await sha256Lower(opts.email);
  if (opts.phone) data.ph = await sha256Lower(opts.phone.replace(/\D/g, ""));
  if (opts.country) data.country = await sha256Lower(opts.country);
  if (Object.keys(data).length === 0) return;
  // Re-initializing the pixel with the same id but new user_data is the
  // documented advanced-matching upgrade. Subsequent events inherit it.
  f("init", PIXEL_ID, data);
}

/**
 * Fire a tracked event. If eventID is provided, Meta dedupes it against
 * the matching CAPI event (server-side fire from /api/waitlist).
 */
export function trackEvent(
  event: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string },
): void {
  const f = fbq();
  if (!f) return;
  f("track", event, params ?? {}, options);
}

/**
 * Read UTM params from current URL. Returns an object with only the
 * tags that are present. Used to thread paid-campaign attribution
 * through from ad click → lead capture → CAPI.
 */
export function readUtms(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const sp = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const k of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
  ]) {
    const v = sp.get(k);
    if (v) out[k] = v.slice(0, 200);
  }
  return out;
}
