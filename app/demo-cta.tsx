"use client";

import { sendGAEvent } from "@next/third-parties/google";

/**
 * Secondary hero CTA — opens the floating ChatWidget by dispatching the
 * `braintech:open-demo` custom event. The widget listens for it and slides
 * up. Surfaces the demo as a real conversion path, not a corner-tucked
 * launcher.
 */
export function DemoCTAClient() {
  function open() {
    sendGAEvent("event", "demo_open_from_hero", {});
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("braintech:open-demo"));
    }
  }
  return (
    <button
      type="button"
      onClick={open}
      data-cta="hero-demo"
      className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[var(--color-ink)] bg-white px-4 py-2.5 text-sm font-medium text-[var(--color-ink)] transition hover:bg-[var(--color-ink)] hover:text-[var(--color-cream)]"
    >
      <span aria-hidden>▶</span>
      Try the live demo — text Bri a rule right now
    </button>
  );
}
