"use client";

import { useEffect, useRef, useState } from "react";
import { sendGAEvent } from "@next/third-parties/google";

type CTA = { label: string; href: string };
type Msg = {
  role: "user" | "assistant";
  content: string;
  // Optional: a conversion chip rendered under an assistant bubble. Used to
  // give visitors a one-click path from the live demo to the waitlist form
  // when Bri's first reply lands.
  cta?: CTA;
};

const OPENER: Msg = {
  role: "assistant",
  content:
    "Hi! I'm Bri 🧠 This is how you'll run Braintech — just by chatting. Want to see it work? Tell me a screen-time rule you wish you could enforce — like “no TikTok for my 9-year-old until she reads 20 minutes” — and I'll show you exactly what Braintech would do. Or ask me anything.",
};

function fbqTrack(event: string, params?: Record<string, unknown>) {
  const w = window as typeof window & { fbq?: (...a: unknown[]) => void };
  if (typeof w.fbq === "function") w.fbq("track", event, params);
}

// proxy.ts seeds bt_var on the first visit; we read it for Pixel breakdowns.
function currentVariation(): string {
  if (typeof document === "undefined") return "unknown";
  const m = document.cookie.match(/(?:^|;\s*)bt_var=(\d+)/);
  return m?.[1] ?? "unknown";
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([OPENER]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [started, setStarted] = useState(false);
  const sessionId = useRef<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = "braintech_chat_session";
    let id = localStorage.getItem(key);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, id);
    }
    sessionId.current = id;
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open, sending]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    if (!started) {
      setStarted(true);
      sendGAEvent("event", "demo_chat_started", {});
      fbqTrack("Lead", { content_name: "chat_demo", variation: currentVariation() });
    }
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.current, message: text }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        reply?: string;
        cta?: CTA;
      };
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            data?.reply ?? "Sorry — I glitched for a second. Mind sending that again?",
          cta: data?.cta,
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Network hiccup — try sending that again?" },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open the Braintech demo chat"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-full bg-[var(--color-ink)] py-3 pl-3 pr-5 text-[var(--color-cream)] shadow-[0_10px_30px_-8px_rgba(0,0,0,0.45)] transition hover:bg-[var(--color-accent)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={28} height={28} className="size-7 rounded-md" />
          <span className="text-sm font-medium">Try the live demo</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed inset-x-3 bottom-3 z-50 flex h-[78vh] max-h-[640px] flex-col overflow-hidden rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[400px]">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-rule)] bg-white px-4 py-3">
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="" width={32} height={32} className="size-8 rounded-md" />
              <div className="leading-tight">
                <div className="text-sm font-semibold">Bri · Braintech</div>
                <div className="text-[11px] text-[var(--color-ink-soft)]">
                  Live demo — try a rule
                </div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="grid size-8 place-items-center rounded-full text-[var(--color-ink-soft)] transition hover:bg-[var(--color-rule)]/40"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="size-5">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex flex-col gap-2 ${
                  m.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <div
                  className={[
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed",
                    m.role === "user"
                      ? "rounded-br-md bg-[var(--color-ink)] text-[var(--color-cream)]"
                      : "rounded-bl-md border border-[var(--color-rule)] bg-white text-[var(--color-ink)]",
                  ].join(" ")}
                >
                  {m.content}
                </div>
                {m.cta && (
                  <a
                    href={m.cta.href}
                    onClick={() => {
                      sendGAEvent("event", "chat_cta_click", {
                        label: m.cta?.label,
                      });
                      fbqTrack("AddToCart", { variation: currentVariation() });
                      // Close the widget so the form is unobscured.
                      setOpen(false);
                    }}
                    className="ml-1 inline-flex items-center gap-2 rounded-full bg-[var(--color-accent)] px-4 py-2 text-[13px] font-medium text-white shadow-[0_6px_16px_-6px_rgba(217,79,26,0.55)] transition hover:brightness-95"
                  >
                    {m.cta.label}
                  </a>
                )}
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md border border-[var(--color-rule)] bg-white px-3.5 py-3">
                  <span className="flex gap-1">
                    <span className="size-1.5 animate-bounce rounded-full bg-[var(--color-ink-soft)] [animation-delay:-0.3s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-[var(--color-ink-soft)] [animation-delay:-0.15s]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-[var(--color-ink-soft)]" />
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-[var(--color-rule)] bg-white p-3">
            <div className="flex items-end gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                maxLength={600}
                placeholder="Type a rule, or ask anything…"
                className="min-w-0 flex-1 rounded-xl border border-[var(--color-rule)] bg-[var(--color-cream)] px-3.5 py-2.5 text-[14px] outline-none transition focus:border-[var(--color-ink)] focus:bg-white"
              />
              <button
                onClick={send}
                disabled={sending || !input.trim()}
                aria-label="Send"
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-accent)] text-white transition hover:brightness-95 disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-5">
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-[var(--color-ink-soft)]/70">
              Demo of Braintech. Not a real device yet — replies are illustrative.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
