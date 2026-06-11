"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ActivityKey = "khan" | "reading" | "ted" | "coding" | "video";

type CatalogVideoUI = {
  id: string;
  title: string;
  speaker: string;
  source: string;
  youtube_id: string;
  duration_seconds: number;
  asset_url: string;
  blurb: string;
  credit_pass: number;
  watched: boolean;
};

const ACTIVITIES: Array<{
  key: ActivityKey;
  label: string;
  emoji: string;
  prompt: string;
  example: string;
  pass: number;
}> = [
  {
    key: "video",
    label: "Watch a video",
    emoji: "🎥",
    prompt: "Pick a video to watch.",
    example: "TED-Ed videos, classic TED talks",
    pass: 25,
  },
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
    label: "TED talk (other)",
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
  | { kind: "video-catalog" }
  | {
      kind: "video-watch";
      video: CatalogVideoUI;
      claim_id: string;
      questions: { q: string }[];
      credit_pass: number;
      credit_partial: number;
    }
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

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m} min` : `${m}m ${r}s`;
}

export function EarnFlow({ mac }: { mac: string }) {
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [subject, setSubject] = useState("");
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);

  // Kid picked a video → server generates the quiz up-front and registers
  // the claim. Videos are self-hosted from Vercel Blob, so YouTube can
  // stay blocked the whole session — no policy push, no countdown. Goes
  // straight to the watch step.
  async function startVideoSession(video: CatalogVideoUI) {
    setStep({ kind: "generating", activity: "video", subject: video.title });
    try {
      const res = await fetch("/api/account/earn/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac, activity: "video", video_id: video.id }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        claim_id?: string;
        questions?: { q: string }[];
        credit_pass?: number;
        credit_partial?: number;
        asset_url?: string;
        message?: string;
        reason?: string;
      };
      if (!data.ok || !data.claim_id || !data.questions) {
        setStep({
          kind: "error",
          message: data.message ?? data.reason ?? "Couldn't set up your video — try again.",
        });
        return;
      }
      setAnswers(["", "", ""]);
      setStep({
        kind: "video-watch",
        video: { ...video, asset_url: data.asset_url ?? video.asset_url },
        claim_id: data.claim_id,
        questions: data.questions,
        credit_pass: data.credit_pass ?? 0,
        credit_partial: data.credit_partial ?? 0,
      });
    } catch {
      setStep({ kind: "error", message: "Network hiccup — try again." });
    }
  }

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
                if (a.key === "video") {
                  setStep({ kind: "video-catalog" });
                } else {
                  setStep({ kind: "describe", activity: a.key });
                }
              }}
              data-activity={a.key}
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

  if (step.kind === "video-catalog") {
    return (
      <VideoCatalog
        mac={mac}
        onBack={() => setStep({ kind: "pick" })}
        onPick={(v) => startVideoSession(v)}
      />
    );
  }

  if (step.kind === "video-watch") {
    return (
      <VideoWatch
        video={step.video}
        onBack={() => setStep({ kind: "video-catalog" })}
        onFinished={() =>
          setStep({
            kind: "quiz",
            claim_id: step.claim_id,
            activity: "video",
            questions: step.questions,
            activity_label: "Video",
            credit_pass: step.credit_pass,
            credit_partial: step.credit_partial,
          })
        }
      />
    );
  }

  if (step.kind === "generating") {
    return (
      <Loading
        label={
          step.activity === "video"
            ? "Writing 3 questions about what you just watched…"
            : "Building your quiz…"
        }
        sub="Should take a few seconds."
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

/* Video catalog — fetches once with ?mac so the server can decorate each
 * entry with `watched: bool`. Watched cards get a "✓ watched" badge and
 * are non-tappable; the kid has to pick a new one to earn credit. */
function VideoCatalog({
  mac,
  onBack,
  onPick,
}: {
  mac: string;
  onBack: () => void;
  onPick: (v: CatalogVideoUI) => void;
}) {
  const [videos, setVideos] = useState<CatalogVideoUI[] | null>(null);
  const [personName, setPersonName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/account/earn/start?mac=${encodeURIComponent(mac)}`, {
      method: "GET",
    })
      .then((r) => r.json())
      .then((data: {
        ok: boolean;
        videos?: CatalogVideoUI[];
        person?: { name: string } | null;
      }) => {
        if (data.ok && data.videos) {
          setVideos(data.videos);
          setPersonName(data.person?.name ?? null);
        } else {
          setError("Couldn't load the video list — try again.");
        }
      })
      .catch(() => setError("Network hiccup — try again."));
  }, [mac]);

  // Sort unwatched first, then watched. Inside each bucket keep server order.
  const sortedVideos = videos
    ? [...videos].sort((a, b) =>
        a.watched === b.watched ? 0 : a.watched ? 1 : -1,
      )
    : null;
  const watchedCount = videos?.filter((v) => v.watched).length ?? 0;

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={onBack}
        className="text-xs text-[var(--color-ink-soft)] underline hover:text-[var(--color-ink)]"
      >
        ← back
      </button>
      <h2 className="serif mt-3 text-2xl leading-snug tracking-[-0.01em]">
        Pick a video.
      </h2>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
        Watch it all the way through, then answer 3 short questions about it.
      </p>
      {personName && watchedCount > 0 ? (
        <p className="mt-2 text-xs font-medium text-[var(--color-accent)]">
          {personName} · {watchedCount} watched so far
        </p>
      ) : null}
      {error && (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}
      {videos === null && !error && <Loading label="Loading videos…" />}
      {videos && videos.length === 0 && !error && (
        <div className="mt-6 rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)] p-4 text-sm text-[var(--color-ink-soft)]">
          The video library is being prepared. Check back in a minute.
        </div>
      )}
      {sortedVideos && sortedVideos.length > 0 && (
        <ul className="mt-6 space-y-3">
          {sortedVideos.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => !v.watched && onPick(v)}
                disabled={v.watched}
                className="flex w-full items-center gap-4 rounded-2xl border border-[var(--color-rule)] bg-white p-3 text-left transition hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/5 disabled:cursor-default disabled:bg-[var(--color-cream)]/50 disabled:opacity-60 disabled:hover:border-[var(--color-rule)] disabled:hover:bg-[var(--color-cream)]/50 sm:p-4"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://i.ytimg.com/vi/${v.youtube_id}/mqdefault.jpg`}
                  alt=""
                  width={160}
                  height={90}
                  className="aspect-video w-24 shrink-0 rounded-lg bg-[var(--color-cream)] object-cover sm:w-32"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold leading-snug text-[var(--color-ink)]">
                    {v.title}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-[var(--color-ink-soft)]">
                    {v.speaker} · {v.source === "ted-ed" ? "TED-Ed" : "TED"} · {formatDuration(v.duration_seconds)}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-[var(--color-ink-soft)]">
                    {v.blurb}
                  </p>
                </div>
                {v.watched ? (
                  <span className="shrink-0 rounded-full bg-[var(--color-ink)]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-soft)]">
                    ✓ watched
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-[var(--color-accent)]/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">
                    +{v.credit_pass}m
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* Video watch — self-hosted MP4 from Vercel Blob. The native <video>
 * `ended` event tells us when the kid finishes; seeking the scrubber
 * past the end won't fire it (browsers only emit `ended` when playback
 * naturally reaches the end). Quiz questions also probe specific
 * moments so a skipped watch fails the score. */
function VideoWatch({
  video,
  onBack,
  onFinished,
}: {
  video: CatalogVideoUI;
  onBack: () => void;
  onFinished: () => void;
}) {
  const [ended, setEnded] = useState(false);

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={onBack}
        className="text-xs text-[var(--color-ink-soft)] underline hover:text-[var(--color-ink)]"
      >
        ← back
      </button>
      <h2 className="serif mt-3 text-2xl leading-snug tracking-[-0.01em]">
        {video.title}
      </h2>
      <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
        {video.speaker} · {formatDuration(video.duration_seconds)} · up to +{video.credit_pass}m credit
      </p>
      <video
        src={video.asset_url}
        controls
        playsInline
        preload="auto"
        onEnded={() => setEnded(true)}
        className="mt-4 aspect-video w-full overflow-hidden rounded-2xl border border-[var(--color-rule)] bg-black"
      />
      <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
        Watch all the way to the end — the questions ask about specific
        moments. Skipping ahead won&rsquo;t work.
      </p>
      <button
        type="button"
        disabled={!ended}
        onClick={onFinished}
        className="mt-4 w-full rounded-full bg-[var(--color-ink)] py-3 font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)] disabled:opacity-40"
      >
        {ended ? "Done watching — start the quiz →" : "Finish watching to unlock"}
      </button>
    </div>
  );
}
