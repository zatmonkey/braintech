"use client";

import { useState } from "react";

// Returns a safe in-app path to land on after login. Honors ?from= if
// it's a same-origin path; falls back to /app. Defends against open
// redirects (no //, no protocol).
function safeFromParam(): string {
  if (typeof window === "undefined") return "/app";
  const raw = new URLSearchParams(window.location.search).get("from");
  if (!raw) return "/app";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/app";
  return raw;
}

export default function LoginPage() {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);

  async function requestCode() {
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Something went wrong");
        return;
      }
      setDevCode(data.devCode ?? null);
      setStep("code");
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Something went wrong");
        return;
      }
      window.location.href = safeFromParam();
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={36} height={36} className="size-9 rounded-md" />
          <span className="text-lg font-semibold tracking-tight">braintech</span>
        </div>

        <h1 className="serif text-3xl tracking-[-0.02em]">
          {step === "email" ? "Sign in" : "Check your email"}
        </h1>
        <p className="mt-2 text-[var(--color-ink-soft)]">
          {step === "email"
            ? "We'll email you a 6-digit code — no password needed."
            : `Enter the code we sent to ${email}.`}
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {step === "email" ? (
            <>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && requestCode()}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-[var(--color-rule)] bg-[var(--color-cream)] px-4 py-3 text-base outline-none transition focus:border-[var(--color-ink)] focus:bg-white"
              />
              <button
                onClick={requestCode}
                disabled={busy || !email}
                className="inline-flex items-center justify-center rounded-lg bg-[var(--color-ink)] px-6 py-3.5 text-base font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)] disabled:opacity-60"
              >
                {busy ? "Sending…" : "Send code"}
              </button>
            </>
          ) : (
            <>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && verify()}
                placeholder="123456"
                className="w-full rounded-lg border border-[var(--color-rule)] bg-[var(--color-cream)] px-4 py-3 text-center text-2xl tracking-[0.4em] outline-none transition focus:border-[var(--color-ink)] focus:bg-white"
              />
              {devCode && (
                <p className="rounded-md bg-[var(--color-accent)]/10 px-3 py-2 text-center text-sm text-[var(--color-accent)]">
                  Dev mode (no email provider): your code is <strong>{devCode}</strong>
                </p>
              )}
              <button
                onClick={verify}
                disabled={busy || code.length !== 6}
                className="inline-flex items-center justify-center rounded-lg bg-[var(--color-ink)] px-6 py-3.5 text-base font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)] disabled:opacity-60"
              >
                {busy ? "Verifying…" : "Sign in"}
              </button>
              <button
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setErr("");
                }}
                className="text-sm text-[var(--color-ink-soft)] underline"
              >
                Use a different email
              </button>
            </>
          )}
          {err && <p className="text-sm text-[var(--color-accent)]">{err}</p>}
        </div>
      </div>
    </main>
  );
}
