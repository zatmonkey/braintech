"use client";

import { useState } from "react";
import Link from "next/link";

type ActivityKey = "khan" | "reading" | "ted" | "coding";

const ACTIVITIES: Array<{
  key: ActivityKey;
  label: string;
  emoji: string;
  prompt: string;
  example: string;
  pass: number;
}> = [
  {
    key: "khan",
    label: "Khan Academy",
    emoji: "🧮",
    prompt: "What did you work on? (Khan)",
    example: "fractions, photosynthesis, the Industrial Revolution",
    pass: 20,
  },
  {
    key: "reading",
    label: "Reading",
    emoji: "📖",
    prompt: "What did you read?",
    example: "Harry Potter chapter 3, The Lightning Thief pages 40–80",
    pass: 25,
  },
  {
    key: "ted",
    label: "TED talk",
    emoji: "🎤",
    prompt: "Which TED talk?",
    example: "the talk title, or the speaker's name",
    pass: 30,
  },
  {
    key: "coding",
    label: "Coding",
    emoji: "💻",
    prompt: "What did you build or learn?",
    example: "Scratch — animated a fish, Code.org loops lesson",
    pass: 25,
  },
];

type Step =
  | { kind: "pick" }
  | { kind: "describe"; activity: ActivityKey }
  | { kind: "generating"; activity: ActivityKey; subject: string }
  | {
      kind: "quiz";
      claim_id: string;
      activity: ActivityKey;
      questions: { q: string }[];
      activity_label: string;
      credit_pass: number;
      credit_partial: number;
    }
  | { kind: "scoring" }
  | {
      kind: "result";
      passed: boolean;
      partial: boolean;
      score: number;
      max_score: number;
      credit_granted: number;
      new_balance: number;
      feedback: string;
    }
  | { kind: "error"; message: string };

export function EarnFlow({ mac }: { mac: string }) {
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [subject, setSubject] = useState("");
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);

  async function startQuiz(activity: ActivityKey, s: string) {
    setStep({ kind: "generating", activity, subject: s });
    try {
      const res = await fetch("/api/account/earn/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac, activity, subject: s }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        claim_id?: string;
        questions?: { q: string }[];
        activity_label?: string;
        credit_pass?: number;
        credit_partial?: number;
        message?: string;
        reason?: string;
      };
      if (!data.ok || !data.claim_id || !data.questions) {
        setStep({
          kind: "error",
          message: data.message ?? data.reason ?? "Couldn't make a quiz — try again.",
        });
        return;
      }
      setAnswers(["", "", ""]);
      setStep({
        kind: "quiz",
        claim_id: data.claim_id,
        activity,
        questions: data.questions,
        activity_label: data.activity_label ?? activity,
        credit_pass: data.credit_pass ?? 0,
        credit_partial: data.credit_partial ?? 0,
      });
    } catch {
      setStep({ kind: "error", message: "Network hiccup — try again." });
    }
  }

  async function submitQuiz(claim_id: string) {
    setStep({ kind: "scoring" });
    try {
      const res = await fetch("/api/account/earn/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim_id, answers }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        passed?: boolean;
        partial?: boolean;
        score?: number;
        max_score?: number;
        credit_granted?: number;
        new_balance?: number;
        feedback?: string;
        message?: string;
        reason?: string;
      };
      if (!data.ok) {
        setStep({
          kind: "error",
          message: data.message ?? data.reason ?? "Scoring failed — try again.",
        });
        return;
      }
      setStep({
        kind: "result",
        passed: !!data.passed,
        partial: !!data.partial,
        score: data.score ?? 0,
        max_score: data.max_score ?? 3,
        credit_granted: data.credit_granted ?? 0,
        new_balance: data.new_balance ?? 0,
        feedback: data.feedback ?? "",
      });
    } catch {
      setStep({ kind: "error", message: "Network hiccup — try again." });
    }
  }

  // ─────────── steps ───────────

  if (step.kind === "pick") {
    return (
      <div className="mt-8">
        <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
          What did you do?
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {ACTIVITIES.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => {
                setSubject("");
                setStep({ kind: "describe", activity: a.key });
              }}
              className="rounded-2xl border border-[var(--color-rule)] bg-white p-4 text-left transition hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/5"
            >
              <div className="flex items-center justify-between">
                <div className="text-2xl">{a.emoji}</div>
                <span className="text-xs font-medium text-[var(--color-accent)]">
                  up to +{a.pass}m
                </span>
              </div>
              <div className="mt-2 font-semibold text-[var(--color-ink)]">
                {a.label}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (step.kind === "describe") {
    const a = ACTIVITIES.find((x) => x.key === step.activity)!;
    return (
      <div className="mt-8">
        <button
          type="button"
          onClick={() => setStep({ kind: "pick" })}
          className="text-xs text-[var(--color-ink-soft)] underline hover:text-[var(--color-ink)]"
        >
          ← back
        </button>
        <div className="mt-3 text-2xl">{a.emoji}</div>
        <h2 className="serif mt-2 text-2xl leading-snug tracking-[-0.01em]">
          {a.prompt}
        </h2>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          e.g. <em>{a.example}</em>
        </p>
        <textarea
          autoFocus
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          rows={2}
          placeholder="Type it here…"
          className="mt-4 w-full rounded-2xl border border-[var(--color-rule)] bg-white p-4 text-base outline-none focus:border-[var(--color-ink)]"
        />
        <button
          type="button"
          disabled={subject.trim().length < 2}
          onClick={() => startQuiz(step.activity, subject.trim())}
          className="mt-4 w-full rounded-full bg-[var(--color-ink)] py-3 font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)] disabled:opacity-40"
        >
          Make a quiz →
        </button>
      </div>
    );
  }

  if (step.kind === "generating") {
    return (
      <Loading
        label="Building your quiz…"
        sub="3 short questions about what you learned."
      />
    );
  }

  if (step.kind === "quiz") {
    return (
      <div className="mt-8">
        <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-accent)]">
          {step.activity_label} · up to +{step.credit_pass}m credit
        </div>
        <h2 className="serif mt-2 text-2xl leading-snug tracking-[-0.01em]">
          Three quick questions.
        </h2>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          Short answers are fine — just show what you remember. Pass all
          three for the full {step.credit_pass} minutes; two of three for{" "}
          {step.credit_partial}; less than that earns 0.
        </p>
        <ol className="mt-6 space-y-5">
          {step.questions.map((q, i) => (
            <li key={i}>
              <label className="block">
                <div className="text-sm font-semibold text-[var(--color-ink)]">
                  {i + 1}. {q.q}
                </div>
                <textarea
                  value={answers[i]}
                  onChange={(e) =>
                    setAnswers((a) => {
                      const next = [...a];
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                  maxLength={1200}
                  rows={3}
                  placeholder="Your answer…"
                  className="mt-2 w-full rounded-2xl border border-[var(--color-rule)] bg-white p-3 text-base outline-none focus:border-[var(--color-ink)]"
                />
              </label>
            </li>
          ))}
        </ol>
        <button
          type="button"
          disabled={answers.every((a) => a.trim().length < 2)}
          onClick={() => submitQuiz(step.claim_id)}
          className="mt-6 w-full rounded-full bg-[var(--color-ink)] py-3 font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)] disabled:opacity-40"
        >
          Submit →
        </button>
      </div>
    );
  }

  if (step.kind === "scoring") {
    return (
      <Loading
        label="Checking your answers…"
        sub="This takes about 10 seconds."
      />
    );
  }

  if (step.kind === "result") {
    const isWin = step.credit_granted > 0;
    return (
      <div className="mt-8 rounded-2xl border border-[var(--color-rule)] bg-white p-6 sm:p-8">
        <div className="text-5xl">{isWin ? "🎉" : "💭"}</div>
        <h2 className="serif mt-3 text-3xl leading-snug tracking-[-0.01em]">
          {step.passed
            ? `Nice — full marks. +${step.credit_granted} min.`
            : step.partial
              ? `Close. +${step.credit_granted} min.`
              : "Not this time."}
        </h2>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          You scored {step.score} of {step.max_score}.
        </p>
        {step.feedback && (
          <p className="mt-4 rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)]/40 p-4 text-sm leading-relaxed text-[var(--color-ink)]">
            {step.feedback}
          </p>
        )}
        <div className="mt-6 rounded-2xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-4 text-sm">
          <span className="text-[var(--color-ink-soft)]">Your pool now:</span>{" "}
          <strong className="text-[var(--color-ink)]">
            🧠 {step.new_balance} min
          </strong>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setStep({ kind: "pick" })}
            className="rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)]"
          >
            Earn more
          </button>
          <Link
            href={`/mine?mac=${mac}`}
            className="rounded-full border border-[var(--color-rule)] px-4 py-2 text-sm font-medium text-[var(--color-ink-soft)] transition hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]"
          >
            Back to my setup
          </Link>
        </div>
      </div>
    );
  }

  // error
  return (
    <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
      {step.message}
      <button
        type="button"
        onClick={() => setStep({ kind: "pick" })}
        className="mt-3 block text-xs underline"
      >
        Start over
      </button>
    </div>
  );
}

function Loading({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="mt-8 rounded-2xl border border-[var(--color-rule)] bg-white p-6 text-center">
      <div className="mx-auto inline-flex gap-1">
        <span className="size-2 animate-bounce rounded-full bg-[var(--color-accent)] [animation-delay:-0.3s]" />
        <span className="size-2 animate-bounce rounded-full bg-[var(--color-accent)] [animation-delay:-0.15s]" />
        <span className="size-2 animate-bounce rounded-full bg-[var(--color-accent)]" />
      </div>
      <div className="mt-3 font-semibold text-[var(--color-ink)]">{label}</div>
      {sub && (
        <div className="mt-1 text-xs text-[var(--color-ink-soft)]">{sub}</div>
      )}
    </div>
  );
}
