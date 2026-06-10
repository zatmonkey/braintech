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

export type ActivityType = "khan" | "reading" | "ted" | "coding";

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
};

function client(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const MODEL = "claude-sonnet-4-6";

export type Question = { q: string };

export async function generateQuiz(
  activity: ActivityType,
  subject: string,
): Promise<Question[]> {
  const cfg = ACTIVITIES[activity];
  if (!cfg) throw new Error(`unknown activity: ${activity}`);
  const system = [
    `You are an even-handed evaluator helping a child claim "brain credits" toward screen time by proving they engaged with a learning activity.`,
    ``,
    `The child says they did: ${cfg.label} — "${subject}".`,
    ``,
    `Write EXACTLY THREE short, level-appropriate, OPEN-ENDED comprehension questions about that specific subject. Rules:`,
    `  - No multiple choice (too easy to fake).`,
    `  - Questions must be answerable in 1–3 sentences by a kid who actually engaged.`,
    `  - Pitch the level appropriately (early-elementary if the subject suggests it, middle-school if it's algebra/TED, etc.).`,
    `  - Avoid questions the kid could answer from the title alone — probe a concept, an example, a feeling, a step.`,
    `  - For reading: ask about a specific event, character motivation, or detail — not "what's it about?".`,
    `  - For Khan / coding: ask about the *idea* not the exact UI ("what does a loop do?" not "what colour was the button?").`,
    ``,
    `Output JSON. No prose, no markdown. Schema: {"questions":[{"q":"..."},{"q":"..."},{"q":"..."}]}`,
  ].join("\n");

  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: 500,
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
  return parsed.questions.map((q) => ({ q: String(q.q).slice(0, 280) }));
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

  const system = [
    `You are scoring a child's answers to a 3-question quiz about ${cfg.label} — "${subject}".`,
    ``,
    `Be strict but fair. For each answer, decide if it shows real engagement with the specific material:`,
    `  - PASS (1 point): on-topic, specific, demonstrates understanding or recall.`,
    `  - FAIL (0 points): vague ("idk", "it was good"), off-topic, copy-paste of the question, gibberish.`,
    `  - A short but correct answer counts as a pass — don't penalize brevity.`,
    `  - A long answer that doesn't address the question is still a fail.`,
    ``,
    `After scoring all three, write ONE sentence of feedback the kid will see (kind but honest).`,
    ``,
    `Output JSON. No prose, no markdown. Schema:`,
    `{"per_question":[0|1,0|1,0|1],"feedback":"..."}`,
  ].join("\n");

  const userBlock = questions
    .map(
      (q, i) =>
        `Q${i + 1}: ${q.q}\nA${i + 1}: ${(answers[i] ?? "").slice(0, 1200)}`,
    )
    .join("\n\n");

  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: 500,
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
  const perQ: number[] = (parsed.per_question ?? [])
    .slice(0, 3)
    .map((n) => (Number(n) === 1 ? 1 : 0));
  let score = 0;
  for (const v of perQ) score += v;
  return {
    score,
    max_score: 3,
    passed: score === 3,
    partial: score === 2,
    feedback: String(parsed.feedback ?? "").slice(0, 240),
  };
}

function stripCodeFence(s: string): string {
  // Tolerate models that wrap JSON in ```json fences even when told not to.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(s);
  return (fence ? fence[1] : s).trim();
}
