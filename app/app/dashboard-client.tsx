"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

/* ────────────────────────────────────────────────────────────────────────
 * NetworkStatusCard — the "Your network" section at the bottom of /app.
 *
 * Was an inline server-rendered block that never updated until a hard
 * page reload, so "Rules active: 0" stayed stuck even after Bri added a
 * rule. Now a client component that subscribes to the same poll +
 * "braintech:state-changed" event as the rest of the dashboard, so every
 * stat (online dot, config status, WAN, uptime, connected count, rules
 * active) updates in the same 5s cadence as the rest of the page.
 * ──────────────────────────────────────────────────────────────────── */
type NetworkDevice = {
  device_id: string;
  label: string | null;
  online: boolean;
  in_sync: boolean;
  wan_up: boolean;
  firmware: string | null;
  uptime_sec: number | null;
  connected_count: number;
};

function fmtUptimeSec(s: number | null): string {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function NetworkStatusCard({
  initial,
  ownerEmail,
}: {
  initial: { devices: NetworkDevice[]; active_rules: number };
  ownerEmail: string;
}) {
  const [state, setState] = useState(initial);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/account/state", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        devices?: Array<{
          device_id: string;
          label: string | null;
          desired_version: number;
          reported_version: number;
          online: boolean;
          in_sync: boolean;
          telemetry: {
            firmware?: string;
            wan_up?: boolean;
            uptime_sec?: number;
            clients?: Array<{ ip?: string }>;
          } | null;
        }>;
        rules?: Array<{ active: boolean }>;
      };
      const devices: NetworkDevice[] = (data.devices ?? []).map((d) => ({
        device_id: d.device_id,
        label: d.label,
        online: d.online,
        in_sync: d.in_sync,
        wan_up: !!d.telemetry?.wan_up,
        firmware: d.telemetry?.firmware ?? null,
        uptime_sec: d.telemetry?.uptime_sec ?? null,
        connected_count: (d.telemetry?.clients ?? []).filter(
          (c) => c.ip && !c.ip.startsWith("fe80"),
        ).length,
      }));
      const active_rules = (data.rules ?? []).filter((r) => r.active).length;
      setState({ devices, active_rules });
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, 5000);
    const onEvt = () => refresh();
    window.addEventListener("braintech:state-changed", onEvt);
    return () => {
      clearInterval(id);
      window.removeEventListener("braintech:state-changed", onEvt);
    };
  }, [refresh]);

  if (state.devices.length === 0) {
    return (
      <div className="mt-3 rounded-2xl border border-[var(--color-rule)] bg-white p-5 text-[var(--color-ink-soft)]">
        No device linked to {ownerEmail} yet. Once your Braintech device is
        registered to your account, its status appears here.
      </div>
    );
  }
  return (
    <div className="mt-3 grid gap-3">
      {state.devices.map((d) => (
        <div
          key={d.device_id}
          className="rounded-2xl border border-[var(--color-rule)] bg-white p-5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-medium">
              <span
                className={`size-2.5 rounded-full ${
                  d.online ? "bg-emerald-500" : "bg-zinc-300"
                }`}
              />
              {d.label ?? d.device_id}
            </div>
            <span className="text-xs text-[var(--color-ink-soft)]">
              {d.online ? "Online" : "Offline"}
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <NSStat
              label="Config"
              value={d.in_sync ? "In sync ✓" : "Updating…"}
            />
            <NSStat label="WAN" value={d.wan_up ? "Up" : "Down"} />
            <NSStat label="Firmware" value={d.firmware ?? "—"} />
            <NSStat label="Uptime" value={fmtUptimeSec(d.uptime_sec)} />
            <NSStat
              label="Connected"
              value={`${d.connected_count} devices`}
            />
            <NSStat
              label="Rules active"
              value={String(state.active_rules)}
            />
          </dl>
        </div>
      ))}
    </div>
  );
}

function NSStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-[var(--color-ink-soft)]">
        {label}
      </dt>
      <dd className="mt-0.5 font-medium text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * UsagePanel — the headline "Usage" block at the top of /app.
 *
 * Was server-rendered once and frozen. Now polls /api/account/state on
 * the 60s usage cadence + responds to braintech:state-changed events so
 * brainrot meter + Top Apps stay current. Renders the same shape the
 * page used to inline.
 * ──────────────────────────────────────────────────────────────────── */
export function UsagePanel({
  initialMinutes,
  initialApps,
}: {
  initialMinutes: number | null;
  initialApps: AppMinutes[];
}) {
  const [minutes, setMinutes] = useState<number | null>(initialMinutes);
  const [apps, setApps] = useState<AppMinutes[]>(initialApps);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/account/state", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        usage?: {
          household_minutes: number | null;
          household_apps: AppMinutes[];
        };
      };
      if (data.usage) {
        setMinutes(data.usage.household_minutes);
        setApps(data.usage.household_apps);
      }
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    // Usage data moves on the minute (brainrot meter rounds to whole
    // minutes), so 60s polling is fine. Bri-triggered state-changed
    // event still triggers an immediate refetch so applying a rule
    // doesn't leave the meter stale until the next minute tick.
    const id = setInterval(refresh, 60_000);
    const onEvt = () => refresh();
    window.addEventListener("braintech:state-changed", onEvt);
    return () => {
      clearInterval(id);
      window.removeEventListener("braintech:state-changed", onEvt);
    };
  }, [refresh]);

  return (
    <div className="mt-3 rounded-2xl border border-[var(--color-rule)] bg-white p-5">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
        <BrainrotMeter minutes={minutes} size="lg" />
        <div className="flex-1">
          <UsageTopApps apps={apps} />
        </div>
      </div>
      <p className="mt-4 text-xs text-[var(--color-ink-soft)]">
        Last 24h. Brain mark goes green when the house stays under
        10 minutes a day of brainrot apps (TikTok, YouTube, Instagram,
        Roblox, &hellip;). Learning apps don&rsquo;t count.
      </p>
    </div>
  );
}

/* PolicyLine — one short sentence describing the live evaluator state.
 * Examples:
 *   Allowing — Sat/Sun 14:00–17:00 window
 *   Allowing — 38 / 120 min used today
 *   Blocking — 120 / 120 min used today · next opens Sat 14:00
 * Designed to fit in the rule row without wrapping on most viewports.
 */
function PolicyLine({ policy }: { policy: PolicyDecisionUI }) {
  const isAllow = policy.decision === "allow";
  const color = isAllow ? "text-emerald-700" : "text-red-600";
  const verb = isAllow ? "Allowing" : "Blocking";

  let reason = "";
  if (isAllow && policy.active_window) {
    const w = policy.active_window;
    reason = `${formatDays(w.days)} ${formatHHMM(w.start_min_of_day)}–${formatHHMM(w.end_min_of_day)} window`;
  } else if (isAllow && policy.active_quota) {
    const q = policy.active_quota;
    reason = `${q.minutes_used} / ${q.minutes_max} min used ${periodLabel(q.period)}`;
  } else if (!isAllow && policy.active_quota) {
    const q = policy.active_quota;
    reason = `${q.minutes_used} / ${q.minutes_max} min used ${periodLabel(q.period)}`;
  } else if (!isAllow) {
    reason = "outside allowed windows";
  }

  const nextOpens =
    !isAllow && policy.next_window_at ? formatNextOpens(policy.next_window_at) : "";

  return (
    <span className={color}>
      {verb}
      {reason && <span className="font-normal"> — {reason}</span>}
      {nextOpens && (
        <span className="font-normal text-[var(--color-ink-soft)]">
          {" "}
          · next opens {nextOpens}
        </span>
      )}
    </span>
  );
}

function formatHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}
function formatDays(days: string[]): string {
  const cap = (d: string) => d.charAt(0).toUpperCase() + d.slice(1);
  if (days.length === 7) return "Every day";
  if (days.length === 5 && ["mon","tue","wed","thu","fri"].every((d) => days.includes(d))) {
    return "Weekdays";
  }
  if (days.length === 2 && ["sat","sun"].every((d) => days.includes(d))) {
    return "Weekends";
  }
  return days.map(cap).join("/");
}
function periodLabel(p: string): string {
  return p === "day" ? "today" : `this ${p}`;
}
function formatNextOpens(iso: string): string {
  try {
    const d = new Date(iso);
    const wkday = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
    return `${wkday} ${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;
  } catch {
    return "";
  }
}

function UsageTopApps({ apps }: { apps: AppMinutes[] }) {
  if (apps.length === 0) {
    return (
      <div className="rounded-lg bg-[var(--color-cream)] p-3 text-center text-sm text-[var(--color-ink-soft)]">
        No app traffic in the last 24h yet.
      </div>
    );
  }
  const top = apps.slice(0, 5);
  return (
    <ul className="space-y-1.5">
      {top.map((a) => (
        <li key={a.app} className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-[var(--color-ink)]">
            {a.app}
          </span>
          <span className="font-mono text-sm text-[var(--color-ink-soft)]">
            {a.minutes}m
          </span>
        </li>
      ))}
      {apps.length > top.length && (
        <li className="text-xs text-[var(--color-ink-soft)]">
          + {apps.length - top.length} more
        </li>
      )}
    </ul>
  );
}

type Msg = { role: "user" | "assistant"; content: string };

export function AccountChat({ compact = false }: { compact?: boolean } = {}) {
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
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  // Any other component can prefill + focus the chat by dispatching
  // `braintech:prefill-chat` on window with `detail` = the seed text.
  // Used by the "+ Add rule" buttons on group tabs — they prefill
  // "For <Maya>, " so the parent just types the rule and hits enter.
  useEffect(() => {
    function onPrefill(e: Event) {
      const seed = (e as CustomEvent<string>).detail ?? "";
      setInput(seed);
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        inputRef.current?.focus();
        // Place cursor at end of seed text.
        const len = seed.length;
        inputRef.current?.setSelectionRange(len, len);
      }, 220);
    }
    window.addEventListener("braintech:prefill-chat", onPrefill);
    return () =>
      window.removeEventListener("braintech:prefill-chat", onPrefill);
  }, []);

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
      // Bri's reply may have just created, applied, or removed a rule —
      // tell the devices panel to refetch immediately so the parent
      // doesn't have to reload to see the change.
      window.dispatchEvent(new CustomEvent("braintech:state-changed"));
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Network hiccup — try again?" }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div ref={rootRef} className={`flex ${compact ? "h-[260px]" : "h-[420px]"} flex-col overflow-hidden rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)]`}>
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
          ref={inputRef}
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

/* ────────────────────────────────────────────────────────────────────────
 * AllDevicesSection — the canonical device list + tabs + group management.
 *
 * One unified surface. Tabs = groups, "+" tab creates a new group inline,
 * tab dropdown lets you rename/delete a group. Selecting a group scopes
 * the list to its members and reveals "Add device" + "Add rule" + the
 * group's active rules. The standalone Groups section is gone — everything
 * lives here.
 * ──────────────────────────────────────────────────────────────────── */

import { BrainrotMeter } from "./brainrot-meter";
import { StatsModal } from "./stats-modal";

export type AppMinutes = { app: string; minutes: number };

type AllDeviceRow = {
  mac: string;
  display_name: string;
  has_label: boolean;
  hostname: string | null;
  ip: string | null;
  last_seen: string;
  first_seen: string;
  connected: boolean;
  group_ids: string[];
  brainrot_minutes: number | null;
  apps: AppMinutes[];
  /** Brain-credit balance (minutes) the kid can spend to extend any
   *  schedule rule's quota. Per-MAC. */
  credit_balance: number;
};

type RuleStatus = "propagating" | "active" | "removing";

type PolicyDecisionUI = {
  decision: "allow" | "enforce";
  evaluated_at: string;
  minutes_used_day: number;
  active_window?: {
    days: string[];
    start_min_of_day: number;
    end_min_of_day: number;
  };
  active_quota?: {
    period: string;
    minutes_used: number;
    minutes_max: number;
  };
  next_window_at?: string;
};

type TabGroup = {
  group_id: string;
  name: string;
  is_default: boolean;
  rule_count: number;
  rules: Array<{
    rule_id: string;
    name: string;
    rule_type: string;
    summary: string | null;
    status: RuleStatus;
    policy?: PolicyDecisionUI;
    credits_spent_today: number;
  }>;
  brainrot_minutes: number | null;
  apps: AppMinutes[];
};

function sumApps(parts: AppMinutes[][]): AppMinutes[] {
  const agg = new Map<string, number>();
  for (const part of parts) {
    for (const a of part) agg.set(a.app, (agg.get(a.app) ?? 0) + a.minutes);
  }
  return Array.from(agg.entries())
    .map(([app, minutes]) => ({ app, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "moments ago";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function AllDevicesSection({
  rows,
  groups: initialGroups,
}: {
  rows: AllDeviceRow[];
  groups: TabGroup[];
}) {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [items, setItems] = useState(rows);
  const [groups, setGroups] = useState(initialGroups);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  // Live refresh: poll /api/account/state every 5s so rules added (or
  // removed) via Bri or another tab show up without the parent reloading
  // the whole page. Also subscribe to a "state-changed" window event the
  // chat component dispatches after every Bri reply — that triggers an
  // immediate fetch so newly-applied rules appear within ~1s, not 5s.
  // Bri's "✅ Done" then has a tight visible feedback loop.
  // Two cadences:
  //   - rules + group membership change frequently (parent clicks Add /
  //     Remove, Bri applies/removes) → poll every 5s
  //   - brainrot meters + top apps change on the minute (DNS-tail
  //     populates buckets in real time but the meter rounds to whole
  //     minutes) → fold in every 60s
  // Both come from /api/account/state in one shot so we don't fan out
  // requests — `applyUsage` controls whether the usage portion of the
  // response merges into local state.
  const refresh = useCallback(async (applyUsage: boolean) => {
    try {
      const res = await fetch("/api/account/state", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        devices?: Array<{ desired_version: number; reported_version: number }>;
        groups?: Array<{
          group_id: string;
          name: string;
          is_default: boolean;
          members: Array<{ mac: string; name: string }>;
          rules: Array<{
            rule_id: string;
            name: string;
            rule_type: string;
            summary: string | null;
            status: RuleStatus;
            policy?: PolicyDecisionUI;
            credits_spent_today?: number;
          }>;
        }>;
        credit_balance_by_mac?: Record<string, number>;
        usage?: {
          household_minutes: number | null;
          household_apps: AppMinutes[];
          per_mac_minutes: Record<string, number>;
          per_group_minutes: Record<string, number | null>;
          per_mac_apps: Record<string, AppMinutes[]>;
        };
      };
      if (Array.isArray(data.groups)) {
        setGroups((prev) => {
          const byId = new Map(prev.map((g) => [g.group_id, g] as const));
          return (data.groups ?? []).map((g) => {
            const old = byId.get(g.group_id);
            const memberMacs = g.members.map((m) => m.mac.toLowerCase());
            const newGroupMinutes = applyUsage && data.usage
              ? data.usage.per_group_minutes[g.group_id] ?? null
              : old?.brainrot_minutes ?? null;
            const newGroupApps =
              applyUsage && data.usage
                ? sumApps(
                    memberMacs.map(
                      (m) => data.usage!.per_mac_apps[m] ?? [],
                    ),
                  )
                : old?.apps ?? [];
            return {
              group_id: g.group_id,
              name: g.name,
              is_default: g.is_default,
              // rule_count: only count rules that are "live" or "going live"
              // — removing-in-flight isn't a real rule for counting purposes.
              rule_count: g.rules.filter((r) => r.status !== "removing").length,
              // Status comes from the server now — it knows active vs
              // propagating vs removing based on device sync + rule active.
              rules: g.rules.map((r) => ({
                ...r,
                credits_spent_today: r.credits_spent_today ?? 0,
              })),
              brainrot_minutes: newGroupMinutes,
              apps: newGroupApps,
            };
          });
        });
        // Credit balance updates land every poll (cheap query).
        if (data.credit_balance_by_mac) {
          const balances = data.credit_balance_by_mac;
          setItems((prevItems) =>
            prevItems.map((row) => ({
              ...row,
              credit_balance: balances[row.mac] ?? 0,
            })),
          );
        }
        // Also update device rows' brainrot/apps when applyUsage.
        if (applyUsage && data.usage) {
          const usage = data.usage;
          setItems((prevItems) =>
            prevItems.map((row) => ({
              ...row,
              brainrot_minutes: usage.per_mac_minutes[row.mac] ?? null,
              apps: usage.per_mac_apps[row.mac] ?? [],
            })),
          );
        }
      }
    } catch {
      // silent — try again next tick
    }
  }, []);
  useEffect(() => {
    const rulesTick = setInterval(() => refresh(false), 5000);
    const usageTick = setInterval(() => refresh(true), 60_000);
    // First tick: refresh both immediately so a freshly-loaded dashboard
    // doesn't wait 60s for usage data after a hard reload.
    refresh(true);
    const onEvt = () => refresh(true);
    window.addEventListener("braintech:state-changed", onEvt);
    return () => {
      clearInterval(rulesTick);
      clearInterval(usageTick);
      window.removeEventListener("braintech:state-changed", onEvt);
    };
  }, [refresh]);
  const [stats, setStats] = useState<{
    open: boolean;
    title: string;
    subtitle?: string;
    minutes: number | null;
    apps: AppMinutes[];
  }>({
    open: false,
    title: "",
    minutes: null,
    apps: [],
  });

  const filtered = selectedGroup
    ? items.filter((r) => r.group_ids.includes(selectedGroup))
    : items;
  const connectedCount = items.filter((r) => r.connected).length;
  const groupNamesById = Object.fromEntries(
    groups.map((g) => [g.group_id, g.name] as const),
  );
  const activeGroup = selectedGroup
    ? groups.find((g) => g.group_id === selectedGroup) ?? null
    : null;
  // For the household-level meter on the "All" tab, sum per-device brainrot
  // (treat null as 0 so missing data doesn't poison the total). If every
  // value is null, show null instead.
  const householdMinutes =
    items.length === 0
      ? null
      : items.every((r) => r.brainrot_minutes === null)
        ? null
        : items.reduce((acc, r) => acc + (r.brainrot_minutes ?? 0), 0);

  function renameLocal(mac: string, name: string) {
    setItems((rs) =>
      rs.map((r) =>
        r.mac === mac.toLowerCase()
          ? { ...r, display_name: name, has_label: name.length > 0 }
          : r,
      ),
    );
  }

  async function createGroup() {
    const name = newGroupName.trim().slice(0, 48);
    if (!name) {
      setNewGroupOpen(false);
      return;
    }
    try {
      const res = await fetch("/api/account/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const gid =
          data?.group_id ??
          data?.id ??
          `g_${Date.now().toString(36)}`;
        setGroups((gs) => [
          ...gs,
          {
            group_id: gid,
            name,
            is_default: false,
            rule_count: 0,
            rules: [],
            brainrot_minutes: null,
            apps: [],
          },
        ]);
        setNewGroupName("");
        setNewGroupOpen(false);
        setSelectedGroup(gid);
      }
    } catch {
      // swallow; user can retry
    }
  }

  async function deleteGroup(gid: string) {
    if (!confirm("Delete this group?")) return;
    try {
      await fetch(`/api/account/groups/${gid}`, { method: "DELETE" });
      setGroups((gs) => gs.filter((g) => g.group_id !== gid));
      setItems((rs) =>
        rs.map((r) => ({
          ...r,
          group_ids: r.group_ids.filter((x) => x !== gid),
        })),
      );
      if (selectedGroup === gid) setSelectedGroup(null);
    } catch {
      /* ignore */
    }
  }

  async function addDeviceToGroup(gid: string, mac: string) {
    try {
      const res = await fetch(`/api/account/groups/${gid}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac }),
      });
      if (res.ok) {
        setItems((rs) =>
          rs.map((r) =>
            r.mac === mac
              ? {
                  ...r,
                  group_ids: r.group_ids.includes(gid)
                    ? r.group_ids
                    : [...r.group_ids, gid],
                }
              : r,
          ),
        );
      }
    } catch {
      /* ignore */
    }
  }

  async function removeDeviceFromGroup(gid: string, mac: string) {
    try {
      await fetch(
        `/api/account/groups/${gid}/members?mac=${encodeURIComponent(mac)}`,
        { method: "DELETE" },
      );
      setItems((rs) =>
        rs.map((r) =>
          r.mac === mac
            ? { ...r, group_ids: r.group_ids.filter((x) => x !== gid) }
            : r,
        ),
      );
    } catch {
      /* ignore */
    }
  }

  function addRuleFor(group: TabGroup) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("braintech:prefill-chat", {
          detail: `For ${group.name}, `,
        }),
      );
    }
  }

  if (items.length === 0 && groups.length === 0) {
    return (
      <div className="mt-3 rounded-2xl border border-[var(--color-rule)] bg-white p-5 text-[var(--color-ink-soft)]">
        No devices reported yet — your Braintech device updates this every
        minute.
      </div>
    );
  }

  // Devices NOT yet in the active group (for the "+ Add device" picker).
  const candidatesForActive = activeGroup
    ? items.filter((r) => !r.group_ids.includes(activeGroup.group_id))
    : [];

  return (
    <div className="mt-3 space-y-3">
      {/* Tab rail */}
      <div className="flex flex-wrap items-center gap-2">
        <TabButton
          active={selectedGroup === null}
          onClick={() => setSelectedGroup(null)}
        >
          All
          <TabCount>{`${connectedCount}/${items.length}`}</TabCount>
        </TabButton>
        {groups.map((g) => (
          <TabButton
            key={g.group_id}
            active={selectedGroup === g.group_id}
            onClick={() => setSelectedGroup(g.group_id)}
          >
            {g.name}
            <TabCount>{g.rule_count}</TabCount>
          </TabButton>
        ))}
        {newGroupOpen ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-ink)] bg-white px-2 py-0.5">
            <input
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onBlur={createGroup}
              onKeyDown={(e) => {
                if (e.key === "Enter") createGroup();
                if (e.key === "Escape") {
                  setNewGroupName("");
                  setNewGroupOpen(false);
                }
              }}
              maxLength={32}
              placeholder="Group name"
              className="w-28 rounded bg-transparent px-1 py-0.5 text-sm outline-none"
            />
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setNewGroupOpen(true)}
            aria-label="Add group"
            className="grid size-7 place-items-center rounded-full border border-dashed border-[var(--color-ink-soft)] text-sm text-[var(--color-ink-soft)] transition hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]"
          >
            +
          </button>
        )}
      </div>

      {/* One unified card. When a group is active: toolbar → (rules) →
          device list → add-device picker, separated by thin internal
          rules so it reads as one piece. When "All" is active: just the
          whole-house header + the device list. */}
      <div className="overflow-hidden rounded-2xl border border-[var(--color-rule)] bg-white">
        {activeGroup ? (
          <>
            {/* Group toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--color-cream)]/40 px-4 py-3">
              <div className="flex items-center gap-3">
                <BrainrotMeter
                  minutes={activeGroup.brainrot_minutes}
                  size="sm"
                  withLabel={false}
                />
                <div>
                  <div className="text-sm font-semibold">{activeGroup.name}</div>
                  <div className="text-xs text-[var(--color-ink-soft)]">
                    {filtered.length} device{filtered.length === 1 ? "" : "s"} ·{" "}
                    {activeGroup.rule_count} rule
                    {activeGroup.rule_count === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => addRuleFor(activeGroup)}
                  className="rounded-full bg-[var(--color-ink)] px-3 py-1.5 text-xs font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)]"
                >
                  + Add rule
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setStats({
                      open: true,
                      title: activeGroup.name,
                      subtitle: "Group · last 24h",
                      minutes: activeGroup.brainrot_minutes,
                      apps: activeGroup.apps,
                    })
                  }
                  className="rounded-full border border-[var(--color-rule)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-soft)] transition hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]"
                >
                  Stats
                </button>
                {!activeGroup.is_default && (
                  <button
                    type="button"
                    onClick={() => deleteGroup(activeGroup.group_id)}
                    className="text-xs text-[var(--color-ink-soft)] underline hover:text-[var(--color-accent)]"
                  >
                    delete group
                  </button>
                )}
              </div>
            </div>

            {/* Active rules — inline below the toolbar. */}
            {activeGroup.rules.length > 0 && (
              <div className="border-t border-[var(--color-rule)] px-4 py-3">
                <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
                  Active rules
                </div>
                <ul className="divide-y divide-[var(--color-rule)]">
                  {activeGroup.rules.map((r) => (
                    <RuleRow
                      key={r.rule_id}
                      ruleId={r.rule_id}
                      name={r.name}
                      ruleType={r.rule_type}
                      summary={r.summary}
                      status={r.status}
                      policy={r.policy}
                      creditsSpentToday={r.credits_spent_today}
                    />
                  ))}
                </ul>
              </div>
            )}

            {/* Devices section header — visually distinct from the toolbar. */}
            <div className="border-t border-[var(--color-rule)] px-4 pt-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
              Devices in this group
            </div>
          </>
        ) : (
          // "All" tab — household summary header
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-rule)] bg-[var(--color-cream)]/40 px-4 py-3">
            <div className="flex items-center gap-3">
              <BrainrotMeter
                minutes={householdMinutes}
                size="sm"
                withLabel={false}
              />
              <div>
                <div className="text-sm font-semibold">Whole house</div>
                <div className="text-xs text-[var(--color-ink-soft)]">
                  {connectedCount} connected · {items.length} seen last 7 days
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                setStats({
                  open: true,
                  title: "Whole house",
                  subtitle: "Aggregate · last 24h",
                  minutes: householdMinutes,
                  apps: sumApps(items.map((r) => r.apps)),
                })
              }
              className="rounded-full border border-[var(--color-rule)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-soft)] transition hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]"
            >
              Stats
            </button>
          </div>
        )}

        <ul className="divide-y divide-[var(--color-rule)]">
          {filtered.map((r) => (
            <AllDeviceListItem
              key={r.mac}
              row={r}
              groupNamesById={groupNamesById}
              activeGroupId={activeGroup?.group_id ?? null}
              onRenamed={renameLocal}
              onRemoveFromGroup={removeDeviceFromGroup}
              onOpenStats={() =>
                setStats({
                  open: true,
                  title: r.display_name,
                  subtitle: r.hostname && r.hostname !== r.display_name
                    ? r.hostname
                    : r.mac,
                  minutes: r.brainrot_minutes,
                  apps: r.apps,
                })
              }
            />
          ))}
          {filtered.length === 0 && (
            <li className="p-5 text-sm text-[var(--color-ink-soft)]">
              {activeGroup
                ? "No devices in this group yet. Add one below."
                : "No devices match this filter."}
            </li>
          )}
        </ul>

        {activeGroup && candidatesForActive.length > 0 && (
          <div className="border-t border-[var(--color-rule)] bg-[var(--color-cream)]/40 p-3">
            <AddDeviceMenu
              groupName={activeGroup.name}
              candidates={candidatesForActive.map((c) => ({
                mac: c.mac,
                name: c.display_name,
              }))}
              onAdd={(mac) => addDeviceToGroup(activeGroup.group_id, mac)}
            />
          </div>
        )}
      </div>

      <StatsModal
        open={stats.open}
        onClose={() => setStats((s) => ({ ...s, open: false }))}
        title={stats.title}
        subtitle={stats.subtitle}
        brainrotMinutes={stats.minutes}
        apps={stats.apps}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? "bg-[var(--color-ink)] text-[var(--color-cream)]"
          : "border border-[var(--color-rule)] text-[var(--color-ink-soft)] hover:border-[var(--color-ink)]"
      }`}
    >
      {children}
    </button>
  );
}

function TabCount({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white/15 px-1.5 py-0.5 font-mono text-[10px] leading-none">
      {children}
    </span>
  );
}

function AddDeviceMenu({
  groupName,
  candidates,
  onAdd,
}: {
  groupName: string;
  candidates: { mac: string; name: string }[];
  onAdd: (mac: string) => void;
}) {
  const [pick, setPick] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-[var(--color-ink-soft)]">
        Add device to {groupName}:
      </span>
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        className="rounded border border-[var(--color-rule)] bg-white px-2 py-1"
      >
        <option value="">Pick a device…</option>
        {candidates.map((c) => (
          <option key={c.mac} value={c.mac}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!pick}
        onClick={() => {
          if (pick) {
            onAdd(pick);
            setPick("");
          }
        }}
        className="rounded-full bg-[var(--color-ink)] px-2.5 py-1 text-xs font-medium text-[var(--color-cream)] disabled:opacity-40"
      >
        Add
      </button>
    </div>
  );
}

function AllDeviceListItem({
  row,
  groupNamesById,
  activeGroupId,
  onRenamed,
  onRemoveFromGroup,
  onOpenStats,
}: {
  row: AllDeviceRow;
  groupNamesById: Record<string, string>;
  activeGroupId: string | null;
  onRenamed: (mac: string, name: string) => void;
  onRemoveFromGroup: (gid: string, mac: string) => void;
  onOpenStats: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.has_label ? row.display_name : "");
  const [saving, setSaving] = useState(false);

  async function save(next: string) {
    const v = next.trim().slice(0, 32);
    if (!v || v === row.display_name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setEditing(false);
    try {
      const res = await fetch("/api/account/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac: row.mac, name: v }),
      });
      if (!res.ok) throw new Error(`rename failed: ${res.status}`);
      onRenamed(row.mac, v);
    } catch {
      /* leave display name unchanged */
    } finally {
      setSaving(false);
    }
  }

  const sub =
    row.hostname && row.hostname !== row.display_name ? row.hostname : row.mac;

  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <BrainrotMeter
          minutes={row.brainrot_minutes}
          size="sm"
          withLabel={false}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              aria-label={row.connected ? "Connected" : "Offline"}
              className={`size-2 shrink-0 rounded-full ${
                row.connected ? "bg-emerald-500" : "bg-zinc-300"
              }`}
            />
            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => save(draft)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save(draft);
                  if (e.key === "Escape") {
                    setDraft(row.has_label ? row.display_name : "");
                    setEditing(false);
                  }
                }}
                disabled={saving}
                maxLength={32}
                placeholder="Maya's iPad…"
                className="w-44 rounded border border-[var(--color-rule)] bg-white px-2 py-0.5 text-sm focus:border-[var(--color-ink)] focus:outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="block max-w-full truncate text-left text-sm font-medium hover:underline"
                title="Click to rename"
              >
                {row.display_name}
              </button>
            )}
          </div>
          <div className="mt-0.5 truncate pl-4 font-mono text-[11px] text-[var(--color-ink-soft)]">
            {sub}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-4">
            {row.group_ids.length > 0 && !activeGroupId &&
              row.group_ids.map((gid) => (
                <span
                  key={gid}
                  className="rounded-full bg-[var(--color-cream)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-ink-soft)]"
                >
                  {groupNamesById[gid] ?? gid}
                </span>
              ))}
            {row.credit_balance > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent)]"
                title={`${row.credit_balance} min of brain credits available`}
              >
                🧠 {row.credit_balance}m credit
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
        {row.connected ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            Connected
            {row.ip && (
              <span className="font-mono text-emerald-600/80">· {row.ip}</span>
            )}
          </span>
        ) : (
          <span className="text-[11px] text-[var(--color-ink-soft)]">
            Last seen {relativeTime(row.last_seen)}
          </span>
        )}
        <div className="flex items-center gap-2 text-[11px]">
          <button
            type="button"
            onClick={onOpenStats}
            className="text-[var(--color-ink-soft)] underline hover:text-[var(--color-ink)]"
          >
            Stats
          </button>
          {activeGroupId && (
            <button
              type="button"
              onClick={() => onRemoveFromGroup(activeGroupId, row.mac)}
              className="text-[var(--color-ink-soft)] underline hover:text-[var(--color-accent)]"
              title="Remove from this group"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export function ClientRow({
  ip,
  mac,
  hostname,
  connected,
  label,
}: {
  ip: string;
  mac: string;
  hostname?: string;
  connected?: boolean;
  label?: string;
}) {
  // Local display state: starts from the server-side `label` prop and gets
  // optimistically updated on save so the parent server component (which
  // only re-renders on full reload) doesn't need to be told. Falls back to
  // hostname / "Unnamed device" when both are empty.
  const initial = label ?? hostname ?? "";
  const [name, setName] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save(next: string) {
    const v = next.trim();
    if (!v || v === name) {
      setEditing(false);
      return;
    }
    // Optimistic update — flip the displayed name immediately, roll back on error.
    const prev = name;
    setName(v);
    setSaving(true);
    setEditing(false);
    try {
      const res = await fetch("/api/account/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac, name: v }),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
    } catch {
      setName(prev);
    } finally {
      setSaving(false);
    }
  }

  const display = name || hostname || "Unnamed device";
  return (
    <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`size-2 shrink-0 rounded-full ${connected ? "bg-emerald-500" : "bg-zinc-300"}`} />
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => save(name)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save(name);
              if (e.key === "Escape") {
                setName(label ?? hostname ?? "");
                setEditing(false);
              }
            }}
            disabled={saving}
            maxLength={32}
            className="min-w-0 max-w-[180px] rounded border border-[var(--color-rule)] bg-white px-2 py-0.5 text-sm focus:border-[var(--color-ink)] focus:outline-none"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="truncate text-left font-medium hover:underline"
            title="Click to rename"
          >
            {display}
          </button>
        )}
      </div>
      <span className="shrink-0 font-mono text-xs text-[var(--color-ink-soft)]">{ip}</span>
    </li>
  );
}

export function RuleRow({
  ruleId,
  name,
  ruleType,
  summary,
  status = "active",
  policy,
  creditsSpentToday = 0,
}: {
  ruleId: string;
  name: string;
  ruleType: string;
  summary: string | null;
  /** "propagating" while the device hasn't reported the new desired_version
   *  yet (in-flight add). "active" once enforced. "removing" while the
   *  parent has clicked remove and the agent hasn't yet picked up the
   *  cleanup — the rule is still on the router until the next sync. */
  status?: "propagating" | "active" | "removing";
  /** Latest evaluator decision for schedule rules. Undefined for
   *  static rules (block_brainrot_group, pause_group). */
  policy?: PolicyDecisionUI;
  /** Brain-credit minutes consumed against this rule today (any MAC).
   *  Surfaces as "+18 from credits today" beside the live decision. */
  creditsSpentToday?: number;
}) {
  const [removing, setRemoving] = useState(false);
  const isRemovingState = status === "removing";
  // For schedule rules, the live policy decision overrides the static
  // colour: green when currently allowing, red when currently enforcing.
  // Static rules keep the original semantics (red while enforced, amber
  // pulse while propagating/removing).
  let dotCls: string;
  let dotTitle: string;
  if (policy) {
    if (status === "propagating" || status === "removing") {
      dotCls = "bg-amber-500 animate-pulse";
      dotTitle =
        status === "removing"
          ? "Removing — device cleaning up"
          : "Propagating — device picking it up";
    } else if (policy.decision === "allow") {
      dotCls = "bg-emerald-500";
      dotTitle = "Allowing right now — schedule lets this app through";
    } else {
      dotCls = "bg-red-500";
      dotTitle = "Blocking right now — schedule is enforcing";
    }
  } else {
    dotCls = status === "active" ? "bg-red-500" : "bg-amber-500 animate-pulse";
    dotTitle =
      status === "active"
        ? "Active — enforcing on the router"
        : status === "removing"
          ? "Removing — device cleaning up"
          : "Propagating — device picking it up";
  }
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`size-2 shrink-0 rounded-full ${dotCls}`}
            title={dotTitle}
            aria-label={dotTitle}
          />
          <span
            className={`font-medium ${
              isRemovingState ? "line-through text-[var(--color-ink-soft)]" : ""
            }`}
          >
            {name}
          </span>
          <span className="text-xs text-[var(--color-ink-soft)]">
            {isRemovingState ? "removing…" : ruleType.replace(/_/g, " ")}
          </span>
        </div>
        {summary && !isRemovingState && (
          <p className="ml-4 mt-1 text-xs text-[var(--color-ink-soft)]">{summary}</p>
        )}
        {policy && !isRemovingState && (
          <p className="ml-4 mt-1 text-xs font-medium">
            <PolicyLine policy={policy} />
            {creditsSpentToday > 0 && (
              <span className="ml-1 font-normal text-[var(--color-accent)]">
                · +{creditsSpentToday} from credits today
              </span>
            )}
          </p>
        )}
      </div>
      <button
        onClick={async () => {
          if (!confirm(`Remove rule "${name}"?`)) return;
          setRemoving(true);
          try {
            await fetch(`/api/account/rules/${ruleId}`, { method: "DELETE" });
            // No reload — the polling refresh in AllDevicesSection will
            // pick the change up within a few seconds.
            window.dispatchEvent(new CustomEvent("braintech:state-changed"));
          } catch {
            setRemoving(false);
          }
        }}
        disabled={removing || isRemovingState}
        className="shrink-0 text-xs text-[var(--color-ink-soft)] underline hover:text-[var(--color-accent)] disabled:opacity-50"
      >
        {isRemovingState ? "removing" : removing ? "removing…" : "remove"}
      </button>
    </li>
  );
}

type GroupMember = { mac: string; name: string };
type AttachedRule = { rule_id: string; rule_type: string; name: string; summary: string | null };
type GroupUI = {
  group_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  members: GroupMember[];
  rules: AttachedRule[];
};

export function GroupsSection({
  groups: initial,
  knownDevices,
}: {
  groups: GroupUI[];
  knownDevices: { mac: string; name: string }[];
}) {
  const [groups, setGroups] = useState<GroupUI[]>(initial);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  async function refresh() {
    try {
      const res = await fetch("/api/account/state", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      // /state includes full group shape; map to GroupUI
      const next: GroupUI[] = (data.groups ?? []).map((g: GroupUI) => g);
      setGroups(next);
    } catch {
      // swallow — keep optimistic state if refresh fails
    }
  }

  async function create() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      await fetch("/api/account/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setNewName("");
      await refresh();
    } finally {
      setCreating(false);
    }
  }

  async function destroy(gid: string) {
    if (!confirm("Delete this group?")) return;
    await fetch(`/api/account/groups/${gid}`, { method: "DELETE" });
    await refresh();
  }

  async function addMember(gid: string, mac: string) {
    if (!mac) return;
    await fetch(`/api/account/groups/${gid}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mac }),
    });
    await refresh();
  }

  async function removeMember(gid: string, mac: string) {
    await fetch(`/api/account/groups/${gid}/members?mac=${encodeURIComponent(mac)}`, {
      method: "DELETE",
    });
    await refresh();
  }

  return (
    <div className="mt-3 space-y-3">
      {groups.map((g) => {
        const memberSet = new Set(g.members.map((m) => m.mac.toLowerCase()));
        const available = knownDevices.filter((d) => !memberSet.has(d.mac.toLowerCase()));
        return (
          <div
            key={g.group_id}
            className="rounded-2xl border border-[var(--color-rule)] bg-white p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{g.name}</span>
                  {g.is_default && (
                    <span className="rounded-full bg-[var(--color-cream)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-ink-soft)]">
                      default
                    </span>
                  )}
                  <span className="text-xs text-[var(--color-ink-soft)]">
                    {g.members.length} device{g.members.length === 1 ? "" : "s"}
                  </span>
                </div>
                {g.description && (
                  <p className="mt-0.5 text-xs text-[var(--color-ink-soft)]">{g.description}</p>
                )}
              </div>
              {!g.is_default && (
                <button
                  onClick={() => destroy(g.group_id)}
                  className="shrink-0 text-xs text-[var(--color-ink-soft)] underline hover:text-[var(--color-accent)]"
                >
                  delete
                </button>
              )}
            </div>

            {/* Members as chips */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {g.members.length === 0 && (
                <span className="text-xs text-[var(--color-ink-soft)]">(no devices yet)</span>
              )}
              {g.members.map((m) => (
                <span
                  key={m.mac}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-cream)] py-1 pl-3 pr-1.5 text-xs"
                >
                  <span className="font-medium">{m.name}</span>
                  <button
                    onClick={() => removeMember(g.group_id, m.mac)}
                    aria-label={`Remove ${m.name}`}
                    className="grid size-4 place-items-center rounded-full text-[var(--color-ink-soft)] hover:bg-white hover:text-[var(--color-accent)]"
                  >
                    ×
                  </button>
                </span>
              ))}
              {available.length > 0 && (
                <AddDeviceSelect
                  available={available}
                  onPick={(mac) => addMember(g.group_id, mac)}
                />
              )}
            </div>

            {/* Attached rules */}
            {g.rules.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-[var(--color-rule)] pt-2.5 text-xs">
                {g.rules.map((r) => (
                  <li
                    key={r.rule_id}
                    className="flex items-center justify-between gap-2 text-[var(--color-ink-soft)]"
                  >
                    <span>
                      <span className="text-[var(--color-accent)]">●</span>{" "}
                      <span className="font-medium text-[var(--color-ink)]">{r.name}</span>
                      <span className="ml-1">{r.rule_type.replace(/_/g, " ")}</span>
                    </span>
                    {r.summary && <span className="truncate">{r.summary}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {/* Create */}
      <div className="flex items-center gap-2 rounded-2xl border border-dashed border-[var(--color-rule)] bg-[var(--color-cream)] p-3">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          maxLength={48}
          placeholder="new group name (e.g. kids, iot, guests)"
          className="min-w-0 flex-1 rounded-md border border-[var(--color-rule)] bg-white px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-ink)]"
        />
        <button
          onClick={create}
          disabled={!newName.trim() || creating}
          className="shrink-0 rounded-md bg-[var(--color-ink)] px-3 py-1.5 text-sm text-[var(--color-cream)] disabled:opacity-40"
        >
          {creating ? "…" : "Create"}
        </button>
      </div>
    </div>
  );
}

function AddDeviceSelect({
  available,
  onPick,
}: {
  available: { mac: string; name: string }[];
  onPick: (mac: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <select
      value={value}
      onChange={(e) => {
        const mac = e.target.value;
        if (mac) {
          onPick(mac);
          setValue("");
        }
      }}
      className="rounded-full border border-dashed border-[var(--color-rule)] bg-white px-3 py-1 text-xs text-[var(--color-ink-soft)] hover:border-[var(--color-ink)] focus:outline-none"
    >
      <option value="">+ add device</option>
      {available.map((d) => (
        <option key={d.mac} value={d.mac}>
          {d.name}
        </option>
      ))}
    </select>
  );
}
