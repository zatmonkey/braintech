/**
 * Server-side rollup mapping. The device agent classifies DNS queries into
 * user-facing app names (TikTok, YouTube, Khan Academy, …); this file is
 * the single source of truth for which of those count toward the brainrot
 * meter vs. the learning column.
 *
 * Keep in sync with `appDomains` in device-agent/usage.go — but only when
 * adding a new app the agent didn't know about. Renames are safe; the
 * dashboard renders whatever string the agent ships.
 */

export const BRAINROT_APPS: ReadonlySet<string> = new Set([
  // Short-form / social
  "TikTok",
  "Instagram",
  "Snapchat",
  "X",
  "Facebook",
  "Reddit",
  "Discord",
  // Long-form video
  "YouTube",
  "Netflix",
  "Twitch",
  "Hulu",
  "HBO Max",
  "Disney+",
  "Prime Video",
  "Vimeo",
  // Games
  "Roblox",
  "Fortnite",
  "Minecraft",
  "Steam",
  "Battle.net",
]);

export const LEARNING_APPS: ReadonlySet<string> = new Set([
  "Khan Academy",
  "TED",
  "Duolingo",
  "Wikipedia",
  "Scratch",
  "Code.org",
  "BrainPOP",
  "National Geographic",
]);

export type AppRollup = "brainrot" | "learning" | "other";

export function rollupFor(app: string): AppRollup {
  if (BRAINROT_APPS.has(app)) return "brainrot";
  if (LEARNING_APPS.has(app)) return "learning";
  return "other";
}
