"use client";

/**
 * Bottom-of-/app panel: list co-admins, invite by email, revoke.
 * The signed-in user is always the "primary" — that row is non-removable.
 */
import { useCallback, useEffect, useState } from "react";

type AdminRow = {
  email: string;
  role: "primary" | "admin";
  invited_at: string | null;
  accepted_at: string | null;
  invited_by: string | null;
};

export function AdminsPanel() {
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const [primary, setPrimary] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/admins");
      const data = (await res.json()) as {
        ok?: boolean;
        primary?: string;
        admins?: AdminRow[];
        error?: string;
      };
      if (data.ok) {
        setAdmins(data.admins ?? []);
        setPrimary(data.primary ?? null);
      } else {
        setError(data.error ?? "Couldn't load admins.");
      }
    } catch {
      setError("Network hiccup loading admins.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/account/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Couldn't invite.");
        return;
      }
      setInfo(`Invite sent to ${email}.`);
      setInviteEmail("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(email: string) {
    if (!confirm(`Revoke ${email}'s admin access?`)) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(
        `/api/account/admins?email=${encodeURIComponent(email)}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Couldn't revoke.");
        return;
      }
      setInfo(`Revoked ${email}.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 rounded-2xl border border-[var(--color-rule)] bg-white p-5">
      <h2 className="serif text-2xl tracking-[-0.01em]">Admins</h2>
      <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
        Anyone you invite signs in with their own email and gets the same powers
        you do. The primary owner can&rsquo;t be removed.
      </p>

      {admins === null && !error ? (
        <p className="mt-4 text-sm text-[var(--color-ink-soft)]">Loading…</p>
      ) : null}

      {admins && admins.length > 0 ? (
        <ul className="mt-4 divide-y divide-[var(--color-rule)] rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)]/30">
          {admins.map((a) => {
            const isPrimary = a.role === "primary";
            const isPending = !isPrimary && !a.accepted_at;
            return (
              <li
                key={a.email}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-[var(--color-ink)]">
                    {a.email}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-soft)]">
                    {isPrimary ? (
                      <span className="rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">
                        Primary owner
                      </span>
                    ) : isPending ? (
                      <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-yellow-800">
                        Invite pending
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                        Active
                      </span>
                    )}
                    {!isPrimary && a.invited_at ? (
                      <span>
                        invited {new Date(a.invited_at).toLocaleDateString()}
                      </span>
                    ) : null}
                  </div>
                </div>
                {!isPrimary ? (
                  <button
                    type="button"
                    onClick={() => revoke(a.email)}
                    disabled={busy}
                    className="text-xs font-medium text-red-700 hover:underline disabled:opacity-40"
                  >
                    Revoke
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Invite form */}
      <div className="mt-4 flex flex-wrap items-end gap-2 sm:flex-nowrap">
        <label className="flex-1">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
            Invite a co-admin
          </span>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="someone@example.com"
            disabled={busy}
            className="mt-1.5 w-full rounded-lg border border-[var(--color-rule)] bg-white p-2.5 text-base outline-none focus:border-[var(--color-ink)]"
          />
        </label>
        <button
          type="button"
          onClick={invite}
          disabled={busy || !inviteEmail.trim()}
          className="rounded-full bg-[var(--color-ink)] px-4 py-2.5 text-sm font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)] disabled:opacity-40"
        >
          {busy ? "…" : "Send invite"}
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {info && !error ? (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {info}
        </p>
      ) : null}

      {primary ? (
        <p className="mt-4 text-xs text-[var(--color-ink-soft)]">
          You&rsquo;re signed in as <strong>{primary}</strong>.
        </p>
      ) : null}
    </section>
  );
}
