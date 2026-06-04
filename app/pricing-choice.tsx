"use client";

/**
 * Interactive Pricing section for the waitlist variations. The two cards on
 * the left ("Free waitlist" / "Lock in your device") are clickable toggles
 * that switch the right-hand form between:
 *
 *   - waitlist   → soft path (email → success state with deposit upsell)
 *   - lockIn     → direct path (email → $50 Stripe checkout, no waitlist row)
 *
 * Deep-link via the URL hash: `#lockin` opens directly in lock-in mode (used
 * by the hero "Or lock your device in for $50 →" links). `#waitlist` lands
 * in the default waitlist mode. Card clicks update the hash too so the back
 * button restores the choice.
 *
 * The buy-now variation (variation.mode === "buyNow") doesn't use this — it
 * renders the $249 purchase form directly without the toggle.
 */

import { useEffect, useState } from "react";
import { sendGAEvent } from "@next/third-parties/google";
import { WaitlistForm } from "./waitlist-form";
import { FoundingMeter } from "./founding-stats";
import type { Variation } from "./variations";
import type { Pricing } from "./lib/pricing";

type Choice = "waitlist" | "lockIn";

function readHashChoice(): Choice | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.toLowerCase();
  if (hash === "#lockin" || hash === "#lock-in") return "lockIn";
  if (hash === "#waitlist") return "waitlist";
  return null;
}

export function PricingChoice({
  variation,
  pricing,
}: {
  variation: Variation;
  pricing: Pricing;
}) {
  const [choice, setChoice] = useState<Choice>("waitlist");

  useEffect(() => {
    // Honour ?#lockin on first load.
    const initial = readHashChoice();
    if (initial) setChoice(initial);
    const onHash = () => {
      const c = readHashChoice();
      if (c) setChoice(c);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function pick(next: Choice, source: "card" | "hash") {
    if (next === choice) return;
    setChoice(next);
    sendGAEvent("event", "pricing_choice", {
      variation: variation.id,
      choice: next,
      source,
    });
    // Update hash without scroll-jumping. history.replaceState skips the
    // re-scroll behaviour of `location.hash = ...`.
    if (typeof window !== "undefined") {
      const target = next === "lockIn" ? "#lockin" : "#waitlist";
      history.replaceState(null, "", target);
    }
  }

  return (
    <div className="grid items-start gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
      <div>
        <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
          Founding members
        </div>
        <h2 className="serif mt-3 text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
          {pricing.purchaseLabel}. Locked in for life.
        </h2>
        <p className="mt-5 text-lg text-[var(--color-ink-soft)]">
          We&apos;re building the first 1,000 devices in a single batch. Two
          ways in — pick one:
        </p>
        <div className="mt-5 space-y-3">
          <ChoiceCard
            id="waitlist"
            selected={choice === "waitlist"}
            onClick={() => pick("waitlist", "card")}
            title="Free waitlist"
            body="Drop your email. We'll notify you when the batch ships. No guaranteed device — first-come from notification."
            badge="Free"
          />
          <ChoiceCard
            id="lockIn"
            selected={choice === "lockIn"}
            onClick={() => pick("lockIn", "card")}
            title="Lock in your device"
            body={`Refundable ${pricing.depositLabel} deposit. Skips the queue. Guarantees you one of the first 1,000. Credited toward your ${pricing.purchaseLabel} founding membership.`}
            badge={`${pricing.depositLabel} · refundable`}
            accent
          />
        </div>
        <ul className="mt-8 space-y-3 text-[var(--color-ink)]">
          {[
            "The braintech device, shipped to you",
            "Unlimited rules across every screen in your home",
            "Up to 6 kids, named and personalized",
            "Direct line to the founders during the beta",
            "Founding price locked in at every renewal",
          ].map((item) => (
            <li key={item} className="flex items-start gap-3">
              <Check />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <FoundingMeter />
        <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
          After the first 1,000, founding pricing goes away.
        </p>
      </div>
      <div>
        <WaitlistForm
          variationId={variation.id}
          // "deposit" is the historical name for the soft waitlist path.
          mode={choice === "lockIn" ? "lockIn" : "deposit"}
          pricing={pricing}
        />
      </div>
    </div>
  );
}

function ChoiceCard({
  id,
  selected,
  onClick,
  title,
  body,
  badge,
  accent,
}: {
  id: string;
  selected: boolean;
  onClick: () => void;
  title: string;
  body: string;
  badge?: string;
  accent?: boolean;
}) {
  // Color logic:
  //   - selected + accent (lock-in)  → strong accent border + soft accent bg
  //   - selected, no accent (waitlist) → ink border, light cream bg
  //   - unselected → neutral border, white bg, dim
  const ring = selected
    ? accent
      ? "border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30 bg-[var(--color-accent)]/[0.05]"
      : "border-[var(--color-ink)] ring-2 ring-[var(--color-ink)]/15 bg-white"
    : "border-[var(--color-rule)] bg-white hover:border-[var(--color-ink)]/40";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-choice={id}
      className={`group w-full rounded-xl border p-4 text-left transition ${ring}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-[var(--color-ink)]">{title}</div>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{body}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {badge && (
            <span
              className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${
                accent
                  ? "bg-[var(--color-accent)] text-white"
                  : "bg-[var(--color-rule)]/70 text-[var(--color-ink)]"
              }`}
            >
              {badge}
            </span>
          )}
          <span
            aria-hidden
            className={`grid size-5 place-items-center rounded-full border-2 transition ${
              selected
                ? accent
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                  : "border-[var(--color-ink)] bg-[var(--color-ink)] text-white"
                : "border-[var(--color-rule)] text-transparent"
            }`}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-3">
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4L8.5 12l6.8-6.7a1 1 0 0 1 1.4 0Z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        </div>
      </div>
    </button>
  );
}

function Check() {
  return (
    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
      <svg viewBox="0 0 20 20" fill="currentColor" className="size-3">
        <path
          fillRule="evenodd"
          d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4L8.5 12l6.8-6.7a1 1 0 0 1 1.4 0Z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  );
}
