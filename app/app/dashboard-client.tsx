"use client";

import { useEffect, useRef, useState } from "react";

export function SWRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}

export function LogoutButton() {
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
      }}
      className="text-sm text-[var(--color-ink-soft)] underline hover:text-[var(--color-ink)]"
    >
      Sign out
    </button>
  );
}

type Msg = { role: "user" | "assistant"; content: string };

export function AccountChat() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm Bri 🧠 Tell me a new rule in plain English — like “no YouTube for Theo until he does 10 minutes of Khan Academy” — or ask me about your setup.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setSending(true);
    try {
      const res = await fetch("/api/account/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json().catch(() => ({}));
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data?.reply ?? "Sorry, try that again?" },
      ]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Network hiccup — try again?" }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[420px] flex-col overflow-hidden rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)]">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={[
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed",
                m.role === "user"
                  ? "rounded-br-md bg-[var(--color-ink)] text-[var(--color-cream)]"
                  : "rounded-bl-md border border-[var(--color-rule)] bg-white",
              ].join(" ")}
            >
              {m.content}
            </div>
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
      <div className="flex items-center gap-2 border-t border-[var(--color-rule)] bg-white p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          maxLength={600}
          placeholder="Tell Bri a rule…"
          className="min-w-0 flex-1 rounded-xl border border-[var(--color-rule)] bg-[var(--color-cream)] px-3.5 py-2.5 text-[14px] outline-none focus:border-[var(--color-ink)] focus:bg-white"
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--color-accent)] text-white transition hover:brightness-95 disabled:opacity-40"
          aria-label="Send"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-5">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
