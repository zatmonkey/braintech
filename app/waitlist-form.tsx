"use client";

import { useState } from "react";
import { sendGAEvent } from "@next/third-parties/google";

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; position?: number }
  | { kind: "error"; message: string };

export function WaitlistForm({
  compact = false,
  variationId,
}: {
  compact?: boolean;
  variationId: string;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ kind: "submitting" });
    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      email: String(data.get("email") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim(),
      variation: variationId,
      source:
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : "/",
    };

    if (!payload.email || !payload.email.includes("@")) {
      setState({ kind: "error", message: "Enter a valid email." });
      return;
    }
    if (!payload.phone || payload.phone.replace(/\D/g, "").length < 7) {
      setState({ kind: "error", message: "Enter a valid phone number." });
      return;
    }

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        sendGAEvent("event", "waitlist_error", {
          variation: variationId,
          status: res.status,
        });
        setState({
          kind: "error",
          message: body?.error ?? "Something went wrong. Try again.",
        });
        return;
      }
      const body = await res.json().catch(() => ({}));
      sendGAEvent("event", "waitlist_submit", {
        variation: variationId,
        position: body?.position,
      });
      sendGAEvent("event", "conversion", {
        variation: variationId,
      });
      setState({ kind: "success", position: body?.position });
      form.reset();
    } catch {
      sendGAEvent("event", "waitlist_error", {
        variation: variationId,
        status: "network",
      });
      setState({
        kind: "error",
        message: "Network error. Try again.",
      });
    }
  }

  if (state.kind === "success") {
    return (
      <div
        className={`rounded-2xl border border-[var(--color-rule)] bg-white p-6 sm:p-8 ${
          compact ? "" : "shadow-[0_1px_0_rgba(0,0,0,0.04)]"
        }`}
      >
        <div className="inline-flex items-center gap-2 rounded-full bg-[var(--color-accent)]/10 px-3 py-1 text-xs font-medium text-[var(--color-accent)]">
          <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
          You&apos;re on the list
        </div>
        <h3 className="serif mt-4 text-2xl sm:text-3xl">
          Welcome, founding parent.
        </h3>
        <p className="mt-2 text-[var(--color-ink-soft)]">
          We&apos;ll text you when your device ships
          {state.position ? (
            <>
              {" "}
              — you&apos;re <strong>#{state.position}</strong> of the first
              1,000.
            </>
          ) : (
            "."
          )}{" "}
          Forward this to a parent who needs it.
        </p>
        <p className="mt-4 font-mono text-xs text-[var(--color-ink-soft)]">
          braintech.app
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className={`rounded-2xl border border-[var(--color-rule)] bg-white p-6 sm:p-8 ${
        compact ? "" : "shadow-[0_1px_0_rgba(0,0,0,0.04)]"
      }`}
    >
      <input type="hidden" name="variation" value={variationId} />
      <div className="flex flex-col gap-3 sm:gap-4">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
            Email
          </span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="mt-1.5 w-full rounded-lg border border-[var(--color-rule)] bg-[var(--color-cream)] px-4 py-3 text-base outline-none transition focus:border-[var(--color-ink)] focus:bg-white"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
            Mobile number{" "}
            <span className="font-normal normal-case text-[var(--color-ink-soft)]/70">
              (we&apos;ll text you a demo)
            </span>
          </span>
          <input
            name="phone"
            type="tel"
            required
            autoComplete="tel"
            placeholder="+1 (555) 123-4567"
            className="mt-1.5 w-full rounded-lg border border-[var(--color-rule)] bg-[var(--color-cream)] px-4 py-3 text-base outline-none transition focus:border-[var(--color-ink)] focus:bg-white"
          />
        </label>
        <button
          type="submit"
          disabled={state.kind === "submitting"}
          data-cta="waitlist-submit"
          data-variation={variationId}
          className="mt-2 inline-flex items-center justify-center rounded-lg bg-[var(--color-ink)] px-6 py-3.5 text-base font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)] disabled:opacity-60"
        >
          {state.kind === "submitting"
            ? "Reserving your spot..."
            : "Claim a founding device →"}
        </button>
        {state.kind === "error" && (
          <p className="text-sm text-[var(--color-accent)]">{state.message}</p>
        )}
        <p className="text-xs text-[var(--color-ink-soft)]">
          No charge today. Founding members lock in $249/year for life. We&apos;ll
          confirm before your card is ever touched.
        </p>
        <p className="text-[11px] leading-relaxed text-[var(--color-ink-soft)]/80">
          By joining, you agree to receive recurring automated texts from
          Braintech at the number provided to set up your account and answer a
          few questions. Consent is not a condition of purchase. Msg &amp; data
          rates may apply. Reply STOP to opt out, HELP for help. See our{" "}
          <a href="/terms" className="underline">
            SMS Terms
          </a>{" "}
          &amp;{" "}
          <a href="/privacy" className="underline">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </form>
  );
}
