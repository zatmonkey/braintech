/**
 * Earn-to-unlock verification.
 *
 * Two server-side primitives:
 *   generateQuiz(activity, subject)  → three short questions
 *   scoreQuiz(activity, subject, qs, as) → {score, passed, feedback}
 *
 * Both call Claude. Behavior is deliberately strict — the whole point of
 * quizzing is that you can't fake it. Generation asks for questions the
 * kid will only answer if they actually engaged with the material;
 * scoring penalizes vague / off-topic / "I don't know" answers.
 *
 * Generated questions are short-answer (no multiple choice — too easy to
 * eliminate options). Three questions is the sweet spot: short enough to
 * not feel like school, long enough to differentiate engagement from a
 * shrug.
 *
 * Credit amounts per activity (pass) are configured here so the kid's
 * page can show them up-front. Parents will be able to tune these per
 * household later; for v1 we ship sensible defaults.
 */
import Anthropic from "@anthropic-ai/sdk";

export type ActivityType = "khan" | "reading" | "ted" | "coding" | "video";

export type EarnConfig = {
  label: string;
  // Description of the activity the kid is claiming, used both in the
  // system prompt and on the picker UI ("What did you read?", etc.).
  subject_prompt: string;
  // Credit minutes for a clean pass (3/3) and a partial pass (2/3).
  // Fails grant 0.
  credit_pass: number;
  credit_partial: number;
};

export const ACTIVITIES: Record<ActivityType, EarnConfig> = {
  khan: {
    label: "Khan Academy",
    subject_prompt:
      "What lesson, video, or topic did you work on? (e.g. \"fractions\", \"photosynthesis\", \"the Industrial Revolution\")",
    credit_pass: 20,
    credit_partial: 10,
  },
  reading: {
    label: "Reading",
    subject_prompt:
      "What book did you read, and what part? (e.g. \"Harry Potter chapter 3\", \"The Lightning Thief pages 40–80\")",
    credit_pass: 25,
    credit_partial: 15,
  },
  ted: {
    label: "TED talk",
    subject_prompt:
      "What TED talk did you watch? (the title or the speaker)",
    credit_pass: 30,
    credit_partial: 15,
  },
  coding: {
    label: "Coding",
    subject_prompt:
      "What did you build or learn? (e.g. \"Scratch — animated a fish\", \"Code.org loops lesson\", \"made a function in Python\")",
    credit_pass: 25,
    credit_partial: 15,
  },
  // "video" subject_prompt is unused — the kid picks from the catalog
  // and the subject is the video's title. Per-video credit values
  // override the type-level defaults; these are just safety floors.
  video: {
    label: "Watch a video",
    subject_prompt: "(catalog pick — no prompt)",
    credit_pass: 20,
    credit_partial: 10,
  },
};

function client(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const MODEL = "claude-sonnet-4-6";

/**
 * One quiz question. Two shapes:
 *   - kind="mc"   → 4 choices, server-known correct index
 *   - kind="open" → free-text reflection, scored leniently by Claude
 *
 * The video flow emits exactly 2 MC + 1 open, in that order. Non-video
 * activities (currently all "coming soon") still get 3 short-answer.
 */
export type Question =
  | { q: string; kind?: "open" }
  | { q: string; kind: "mc"; choices: string[]; answer_index: number };

function ageTier(age: number | null | undefined): string {
  if (age == null) return "a curious kid (age unknown, pitch around 10-12)";
  if (age <= 8) return `an early-elementary kid (age ${age})`;
  if (age <= 11) return `a late-elementary kid (age ${age})`;
  if (age <= 14) return `a middle-school kid (age ${age})`;
  return `a high-school-aged kid (age ${age})`;
}

export async function generateQuiz(
  activity: ActivityType,
  subject: string,
  /**
   * For activity="video": pass the video's title + speaker. The kid
   * just finished watching; the quiz mixes 2 multiple-choice (verifies
   * they watched) + 1 open reflection (rewards thinking, not recall).
   */
  videoMeta?: { title: string; speaker: string; source: string },
  /**
   * Optional kid age — drives difficulty pitch in the prompt.
   */
  age?: number | null,
): Promise<Question[]> {
  const cfg = ACTIVITIES[activity];
  if (!cfg) throw new Error(`unknown activity: ${activity}`);
  let system: string;
  if (activity === "video" && videoMeta) {
    system = [
      `You are writing a brief quiz that lets a kid claim brain credits after watching a video. The goal is NOT to test memorization — it's to confirm engagement and reward reflection.`,
      ``,
      `The child just finished watching:`,
      `  Title: ${videoMeta.title}`,
      `  Speaker: ${videoMeta.speaker}`,
      `  Source: ${videoMeta.source}`,
      ``,
      `Pitch the difficulty for ${ageTier(age)}.`,
      ``,
      `Output EXACTLY THREE questions, in this order:`,
      `  1. MULTIPLE CHOICE — about a SPECIFIC moment, example, or claim from the early-to-middle of the video. 4 choices, exactly one correct. Plausible distractors (no "obviously dumb" options). Avoid length tells — don't make the correct answer the longest.`,
      `  2. MULTIPLE CHOICE — same constraints, but about a moment, claim, or turn in the middle-to-late part of the video.`,
      `  3. OPEN-ENDED REFLECTION — invite a personal answer about what the kid learned, noticed, or wondered. The point is to make them think. Easy to pass: any thoughtful, on-topic response counts.`,
      ``,
      `Output JSON only. No prose, no markdown. Schema:`,
      `{"questions":[`,
      `  {"q":"...","kind":"mc","choices":["A","B","C","D"],"answer_index":0},`,
      `  {"q":"...","kind":"mc","choices":["A","B","C","D"],"answer_index":2},`,
      `  {"q":"...","kind":"open"}`,
      `]}`,
    ].join("\n");
  } else {
    system = [
      `You are an even-handed evaluator helping a child claim "brain credits" toward screen time by proving they engaged with a learning activity.`,
      ``,
      `The child says they did: ${cfg.label} — "${subject}".`,
      ``,
      `Pitch the difficulty for ${ageTier(age)}.`,
      ``,
      `Write EXACTLY THREE short, OPEN-ENDED comprehension questions about that specific subject. Rules:`,
      `  - Questions must be answerable in 1–3 sentences by a kid who actually engaged.`,
      `  - Avoid questions the kid could answer from the title alone — probe a concept, an example, a feeling, a step.`,
      ``,
      `Output JSON. No prose, no markdown. Schema: {"questions":[{"q":"...","kind":"open"},{"q":"...","kind":"open"},{"q":"...","kind":"open"}]}`,
    ].join("\n");
  }

  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: 800,
    system,
    messages: [{ role: "user", content: "Generate the quiz now." }],
  });
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  const json = stripCodeFence(text);
  const parsed = JSON.parse(json) as { questions: Question[] };
  if (!parsed?.questions || parsed.questions.length !== 3) {
    throw new Error("generator returned the wrong shape");
  }
  return parsed.questions.map((q) => {
    if ((q as { kind?: string }).kind === "mc") {
      const mc = q as { q: string; choices: string[]; answer_index: number };
      const choices = (mc.choices ?? []).slice(0, 4).map((c) => String(c).slice(0, 200));
      const ai = Math.max(0, Math.min(3, Number(mc.answer_index ?? 0)));
      return {
        q: String(mc.q).slice(0, 280),
        kind: "mc" as const,
        choices,
        answer_index: ai,
      };
    }
    return { q: String((q as { q: string }).q).slice(0, 280), kind: "open" as const };
  });
}

export type ScoreResult = {
  score: number; // 0..3
  max_score: 3;
  passed: boolean;
  partial: boolean;
  // One-sentence feedback the kid sees on the result page.
  feedback: string;
};

export async function scoreQuiz(
  activity: ActivityType,
  subject: string,
  questions: Question[],
  answers: string[],
): Promise<ScoreResult> {
  const cfg = ACTIVITIES[activity];
  if (!cfg) throw new Error(`unknown activity: ${activity}`);
  if (questions.length !== answers.length) {
    throw new Error("questions / answers mismatch");
  }

  // MC scoring is deterministic — exact-match against the stored
  // answer_index. Open-ended scoring goes to Claude with a deliberately
  // LENIENT rubric: the point of the reflection question is to make the
  // kid think, not to test recall. Any thoughtful, on-topic response
  // passes; only gibberish / blank / off-topic fails.
  const perQ: number[] = new Array(questions.length).fill(0);
  const openIndices: number[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const a = String(answers[i] ?? "").trim();
    if ((q as { kind?: string }).kind === "mc") {
      const mc = q as { choices: string[]; answer_index: number };
      // Frontend sends the chosen choice text (canonical) — match against
      // both the text of the correct choice AND the index as a string
      // so either contract works.
      const correctText = (mc.choices?.[mc.answer_index] ?? "").trim();
      if (a && (a === correctText || a === String(mc.answer_index))) {
        perQ[i] = 1;
      }
    } else {
      openIndices.push(i);
    }
  }

  let feedback = "";
  if (openIndices.length > 0) {
    const system = [
      `You are scoring the OPEN-ENDED reflection answers from a kid who just watched a video and is claiming brain credits.`,
      ``,
      `Subject: ${cfg.label} — "${subject}".`,
      ``,
      `The reflection is meant to reward thinking, not test memorization. Be LENIENT:`,
      `  - PASS (1 point): any thoughtful, on-topic response. Personal opinions, half-formed thoughts, "I noticed that..." — all PASS. Short answers PASS if they're on-topic.`,
      `  - FAIL (0 points): only fail if the answer is BLANK, GIBBERISH, totally off-topic, or just copy-pastes the question.`,
      `  - When in doubt, pass. The point is to encourage engagement.`,
      ``,
      `Also write ONE sentence of friendly feedback the kid will see (kind, never preachy).`,
      ``,
      `Output JSON only. Schema: {"per_question":[0|1, ...],"feedback":"..."}`,
      `  - per_question MUST have exactly ${openIndices.length} entries, in the order the questions appear below.`,
    ].join("\n");

    const userBlock = openIndices
      .map(
        (i, idx) =>
          `Q${idx + 1}: ${questions[i].q}\nA${idx + 1}: ${String(answers[i] ?? "").slice(0, 1200)}`,
      )
      .join("\n\n");

    const resp = await client().messages.create({
      model: MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: userBlock }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const json = stripCodeFence(text);
    const parsed = JSON.parse(json) as {
      per_question: number[];
      feedback: string;
    };
    const openScores: number[] = (parsed.per_question ?? [])
      .slice(0, openIndices.length)
      .map((n) => (Number(n) === 1 ? 1 : 0));
    openIndices.forEach((qi, oi) => {
      perQ[qi] = openScores[oi] ?? 0;
    });
    feedback = String(parsed.feedback ?? "").slice(0, 240);
  }

  let score = 0;
  for (const v of perQ) score += v;
  return {
    score,
    max_score: 3,
    passed: score === 3,
    partial: score === 2,
    feedback,
  };
}

function stripCodeFence(s: string): string {
  // Tolerate models that wrap JSON in ```json fences even when told not to.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(s);
  return (fence ? fence[1] : s).trim();
}
