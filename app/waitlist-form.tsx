"use client";

import { useState } from "react";
import { sendGAEvent } from "@next/third-parties/google";

function fbqTrack(event: string, params?: Record<string, unknown>) {
  const w = window as typeof window & { fbq?: (...a: unknown[]) => void };
  if (typeof w.fbq === "function") w.fbq("track", event, params);
}

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; position?: number; email: string }
  | { kind: "error"; message: string };

export function WaitlistForm({
  compact = false,
  variationId,
  mode = "deposit",
}: {
  compact?: boolean;
  variationId: string;
  // "deposit" = current behaviour (waitlist email + $50 lock-in upsell).
  // "purchase" = single button straight to a $249/yr Stripe checkout.
  mode?: "deposit" | "purchase";
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [reserving, setReserving] = useState(false);

  async function startCheckout(
    email: string,
    checkoutMode: "deposit" | "purchase" = "deposit",
  ) {
    setReserving(true);
    sendGAEvent("event", "reserve_click", {
      variation: variationId,
      mode: checkoutMode,
    });
    fbqTrack("InitiateCheckout", {
      value: checkoutMode === "purchase" ? 249 : 50,
      currency: "USD",
      variation: variationId,
      mode: checkoutMode,
    });
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          mode: checkoutMode,
          variation: variationId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.url) {
        window.location.href = data.url as string;
        return;
      }
    } catch {
      /* fall through to reset */
    }
    setReserving(false);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ kind: "submitting" });
    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      email: String(data.get("email") ?? "").trim(),
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
      fbqTrack("Contact");
      fbqTrack("Lead", { content_name: "waitlist", variation: variationId });
      setState({
        kind: "success",
        position: body?.position,
        email: payload.email,
      });
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
          On the waitlist
        </div>
        <h3 className="serif mt-4 text-2xl leading-snug sm:text-3xl">
          The waitlist is free — but unordered.
        </h3>
        <p className="mt-2 text-[var(--color-ink-soft)]">
          We&apos;ll email you when the first batch is ready to ship — no
          guaranteed slot. Want a guaranteed device, ahead of everyone else?
          Drop a <strong>$50 refundable deposit</strong> and we lock one of
          the first 1,000 with your name on it. Ships{" "}
          <strong>worldwide September 1</strong>.
        </p>
        <button
          type="button"
          onClick={() => startCheckout(state.email, "deposit")}
          disabled={reserving}
          data-cta="reserve-deposit"
          data-variation={variationId}
          className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-[var(--color-accent)] px-6 py-3.5 text-base font-medium text-white transition hover:brightness-95 disabled:opacity-60"
        >
          {reserving
            ? "Taking you to checkout…"
            : "Lock in my device — $50 deposit →"}
        </button>
        <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
          Secure checkout via Stripe. Refundable any time before your device
          ships. Credited toward your $249/yr founding membership.
        </p>
        <p className="mt-4 border-t border-[var(--color-rule)] pt-4 text-sm text-[var(--color-ink-soft)]">
          Not ready? You&apos;re still on the waitlist — we&apos;ll email you
          before the batch ships.
        </p>
      </div>
    );
  }

  // Buy-now variation: the pricing form is a single $249/yr Stripe button.
  // No waitlist step, no deposit, no upsell — they came here to buy.
  if (mode === "purchase") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          const email = String(formData.get("email") ?? "").trim();
          if (email && email.includes("@")) startCheckout(email, "purchase");
          else setState({ kind: "error", message: "Enter a valid email." });
        }}
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
          <button
            type="submit"
            disabled={reserving}
            data-cta="purchase-submit"
            data-variation={variationId}
            className="mt-2 inline-flex items-center justify-center rounded-lg bg-[var(--color-accent)] px-6 py-3.5 text-base font-medium text-white transition hover:brightness-95 disabled:opacity-60"
          >
            {reserving ? "Opening checkout…" : "Buy now — $249/yr →"}
          </button>
          {state.kind === "error" && (
            <p className="text-sm text-[var(--color-accent)]">{state.message}</p>
          )}
          <p className="text-xs text-[var(--color-ink-soft)]">
            Device included · ships worldwide September 1 · founding price
            locked at every renewal. Secure checkout via Stripe.
          </p>
        </div>
      </form>
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
        <button
          type="submit"
          disabled={state.kind === "submitting"}
          data-cta="waitlist-submit"
          data-variation={variationId}
          className="mt-2 inline-flex items-center justify-center rounded-lg bg-[var(--color-ink)] px-6 py-3.5 text-base font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)] disabled:opacity-60"
        >
          {state.kind === "submitting"
            ? "Joining…"
            : "Join the waitlist — free →"}
        </button>
        {state.kind === "error" && (
          <p className="text-sm text-[var(--color-accent)]">{state.message}</p>
        )}
        <p className="text-xs text-[var(--color-ink-soft)]">
          Free to join — we email when devices ship. No order in the queue.
          Want yours guaranteed? Lock it in with a $50 refundable deposit on
          the next step.
        </p>
      </div>
    </form>
  );
}
