/**
 * Curated catalog of TED / TED-Ed videos kids can watch to earn credits.
 *
 * Source of truth: app/lib/video-catalog.generated.json — written by
 * scripts/fetch-earn-videos.sh after it resolves curated titles via
 * yt-dlp, downloads each video, and uploads to Vercel Blob. The script's
 * input is scripts/earn-videos-curation.json (titles + topics + blurbs).
 *
 * Why self-hosted instead of YouTube iframes: YouTube stays blocked for
 * the kid the entire time, so there's no "earn session punch-through" to
 * keep secure. The video plays from our Blob bucket on the same origin
 * as the page; the catch-22 disappears.
 *
 * IDs are stable; we ship and version both this list and the resolved
 * generated JSON as part of the codebase.
 */
import generated from "./video-catalog.generated.json";

export type CatalogVideo = {
  id: string;
  title: string;
  speaker: string;
  source: "ted" | "ted-ed";
  // Resolved YouTube id (for debugging + provenance). The player loads
  // asset_url, not this.
  youtube_id: string;
  duration_seconds: number;
  // Vercel Blob URL where the MP4 is hosted. Self-served means no
  // YouTube unblock is needed during an earn session.
  asset_url: string;
  blurb: string;
  topics: string[];
  age_min: number;
  // Credit minutes for a 3/3 pass.
  credit_pass: number;
  // Credit minutes for a 2/3 partial.
  credit_partial: number;
};

export const VIDEO_CATALOG: CatalogVideo[] =
  generated as CatalogVideo[];

export function videoById(id: string): CatalogVideo | undefined {
  return VIDEO_CATALOG.find((v) => v.id === id);
}
