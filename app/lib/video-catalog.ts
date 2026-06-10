/**
 * Curated catalog of TED / TED-Ed videos kids can watch to earn credits.
 *
 * Each entry is hand-picked for: (1) well-known enough that Claude can
 * quiz accurately from its training data, (2) 4–12 min so kids actually
 * finish, (3) genuinely educational, (4) age-appropriate. Catalog is
 * code for v1 — moves to a DB table when we add parent curation.
 *
 * IDs are stable; we ship and version this list as part of the codebase.
 */

export type CatalogVideo = {
  id: string; // stable id we control
  title: string;
  speaker: string;
  source: "ted" | "ted-ed";
  // YouTube video id for the embedded player. Every TED + TED-Ed talk
  // is on YouTube, so this is the cleanest embed path.
  youtube_id: string;
  duration_seconds: number;
  // Short pitch shown on the picker card.
  blurb: string;
  // Topic tags for future filtering. Free-form for now.
  topics: string[];
  // Suggested age range — the picker can filter once we know the kid's
  // age from household memory.
  age_min: number;
  // Credit minutes for a 3/3 pass.
  credit_pass: number;
  // Credit minutes for a 2/3 partial.
  credit_partial: number;
};

export const VIDEO_CATALOG: CatalogVideo[] = [
  {
    id: "ted_ed_why_do_we_yawn",
    title: "Why do we yawn?",
    speaker: "Claudia Aguirre",
    source: "ted-ed",
    youtube_id: "OD8XOd8t0Nw",
    duration_seconds: 5 * 60 + 5,
    blurb:
      "Everyone does it, even babies before they're born. Why is yawning contagious — and what's it actually for?",
    topics: ["biology", "behavior"],
    age_min: 8,
    credit_pass: 20,
    credit_partial: 10,
  },
  {
    id: "ted_ed_how_sugar_brain",
    title: "How sugar affects the brain",
    speaker: "Nicole Avena",
    source: "ted-ed",
    youtube_id: "lEXBxijQREo",
    duration_seconds: 5 * 60 + 23,
    blurb:
      "When you eat sugar, your brain lights up the same way it does with addictive drugs. Here's the chemistry of why.",
    topics: ["biology", "health", "neuroscience"],
    age_min: 9,
    credit_pass: 20,
    credit_partial: 10,
  },
  {
    id: "ted_ed_attention_works",
    title: "How does your brain choose what to pay attention to?",
    speaker: "Mindy McAdams",
    source: "ted-ed",
    youtube_id: "Y_-Iq3LBeMQ",
    duration_seconds: 5 * 60 + 15,
    blurb:
      "Why can you ignore a loud bus but instantly notice someone saying your name? The science of attention.",
    topics: ["neuroscience", "psychology"],
    age_min: 9,
    credit_pass: 20,
    credit_partial: 10,
  },
  {
    id: "ted_ken_robinson_schools_creativity",
    title: "Do schools kill creativity?",
    speaker: "Sir Ken Robinson",
    source: "ted",
    youtube_id: "iG9CE55wbtY",
    duration_seconds: 19 * 60 + 24,
    blurb:
      "The most-watched TED talk ever. A funny, sharp argument that school squeezes creativity out of kids.",
    topics: ["education", "creativity"],
    age_min: 11,
    credit_pass: 35,
    credit_partial: 18,
  },
  {
    id: "ted_ed_grit",
    title: "Grit: the power of passion and perseverance",
    speaker: "Angela Duckworth",
    source: "ted",
    youtube_id: "H14bBuluwB8",
    duration_seconds: 6 * 60 + 12,
    blurb:
      "Why some kids succeed where others give up. It's not IQ — it's grit. (And you can build it.)",
    topics: ["psychology", "growth-mindset"],
    age_min: 10,
    credit_pass: 25,
    credit_partial: 13,
  },
  {
    id: "ted_ed_why_sleep_matters",
    title: "What would happen if you didn't sleep?",
    speaker: "Claudia Aguirre",
    source: "ted-ed",
    youtube_id: "dqONk48l5vY",
    duration_seconds: 4 * 60 + 32,
    blurb:
      "What goes wrong in your brain and body when you skip sleep — from one night to a week.",
    topics: ["biology", "neuroscience"],
    age_min: 8,
    credit_pass: 20,
    credit_partial: 10,
  },
];

export function videoById(id: string): CatalogVideo | undefined {
  return VIDEO_CATALOG.find((v) => v.id === id);
}
