"use client";

/**
 * One-time self-registration form for a device hitting /mine that
 * isn't yet linked to a person. Shown when the server returns
 * person=null AND available_groups (kid/adult groups in the household).
 *
 * Form state machine:
 *   - default: pick from existing groups, or "+ new person"
 *   - new person sub-form: name + kind (kid|adult)
 *
 * On submit: POST /api/account/mine/register; reload the page on
 * success so the parent layout flips to KidPortal.
 */
import { useState } from "react";

type AvailableGroup = {
  group_id: string;
  name: string;
  kind: "kid" | "adult";
};

export function RegisterForm({
  mac,
  defaultLabel,
  availableGroups,
}: {
  mac: string;
  defaultLabel: string;
  availableGroups: AvailableGroup[];
}) {
  const [label, setLabel] = useState(defaultLabel);
  // Selected target: either an existing group_id or '__new__'.
  const [selected, setSelected] = useState<string>(
    availableGroups.length > 0 ? availableGroups[0].group_id : "__new__",
  );
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<"kid" | "adult">("kid");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usingNew = selected === "__new__";
  const canSubmit =
    !busy &&
    label.trim().length > 0 &&
    (usingNew ? newName.trim().length > 0 : selected.length > 0);

  async function onSubmit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/mine/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mac,
          label: label.trim(),
          ...(usingNew
            ? {
                new_group: {
                  person_name: newName.trim(),
                  kind: newKind,
                },
              }
            : { existing_group_id: selected }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.reason ?? "Couldn't register — try again.");
        setBusy(false);
        return;
      }
      // Page reload so the server re-renders as KidPortal.
      window.location.reload();
    } catch {
      setError("Network hiccup — try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
        First time
      </div>
      <h1 className="serif mt-3 text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
        Whose device is this?
      </h1>
      <p className="mt-3 text-base text-[var(--color-ink-soft)]">
        Pick who&rsquo;s using this device and give it a name. This is one-time —
        once it&rsquo;s set, a parent can move it on the dashboard.
      </p>

      <div className="mt-8 space-y-6 rounded-2xl border border-[var(--color-rule)] bg-white p-5 sm:p-6">
        {/* Person picker */}
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
            Who is this?
          </div>
          <ul className="mt-3 space-y-2">
            {availableGroups.map((g) => {
              const checked = selected === g.group_id;
              return (
                <li key={g.group_id}>
                  <label
                    className={
                      "flex cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition " +
                      (checked
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5"
                        : "border-[var(--color-rule)] bg-white hover:border-[var(--color-accent)]")
                    }
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="person"
                        value={g.group_id}
                        checked={checked}
                        onChange={() => setSelected(g.group_id)}
                        className="accent-[var(--color-accent)]"
                      />
                      <span className="font-medium text-[var(--color-ink)]">
                        {g.name}
                      </span>
                    </div>
                    <span className="rounded-full bg-[var(--color-cream)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-soft)]">
                      {g.kind}
                    </span>
                  </label>
                </li>
              );
            })}
            <li>
              <label
                className={
                  "flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition " +
                  (usingNew
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5"
                    : "border-dashed border-[var(--color-rule)] bg-white hover:border-[var(--color-accent)]")
                }
              >
                <input
                  type="radio"
                  name="person"
                  value="__new__"
                  checked={usingNew}
                  onChange={() => setSelected("__new__")}
                  className="accent-[var(--color-accent)]"
                />
                <span className="font-medium text-[var(--color-ink)]">
                  + Add a new person
                </span>
              </label>
            </li>
          </ul>
        </div>

        {/* New person details */}
        {usingNew ? (
          <div className="space-y-3 rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)]/30 p-4">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
                Their name
              </span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Alex, Mom"
                maxLength={64}
                autoFocus
                className="mt-1.5 w-full rounded-xl border border-[var(--color-rule)] bg-white p-2.5 text-base outline-none focus:border-[var(--color-ink)]"
              />
            </label>
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
                Kid or adult?
              </span>
              <div className="mt-1.5 inline-flex rounded-full border border-[var(--color-rule)] bg-white p-1">
                {(["kid", "adult"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setNewKind(k)}
                    className={
                      "rounded-full px-4 py-1.5 text-sm font-medium transition " +
                      (newKind === k
                        ? "bg-[var(--color-ink)] text-[var(--color-cream)]"
                        : "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]")
                    }
                  >
                    {k === "kid" ? "👶 Kid" : "🧑 Adult"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* Device label */}
        <div>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
              What should we call this device?
            </span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Alex's phone"
              maxLength={64}
              className="mt-1.5 w-full rounded-xl border border-[var(--color-rule)] bg-white p-2.5 text-base outline-none focus:border-[var(--color-ink)]"
            />
          </label>
          <p className="mt-1.5 font-mono text-[10px] text-[var(--color-ink-soft)]">
            {mac}
          </p>
        </div>

        {error ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={onSubmit}
          className="w-full rounded-full bg-[var(--color-ink)] py-3 font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)] disabled:opacity-40"
        >
          {busy ? "Setting up…" : "All set — let's go"}
        </button>

        <p className="text-center text-xs text-[var(--color-ink-soft)]">
          This is a one-time setup. After this, only a parent can change
          who&rsquo;s using this device.
        </p>
      </div>
    </>
  );
}
