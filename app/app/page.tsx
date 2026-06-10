import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import {
  getSql,
  ensureDeviceSchema,
  ensureAccountSchema,
  ensureDefaultGroup,
} from "@/app/lib/db";
import { loadMacGroups, loadAllDevices } from "@/app/lib/groups";
import {
  SWRegister,
  LogoutButton,
  AccountChat,
  AllDevicesSection,
} from "./dashboard-client";
import { BrainrotMeter } from "./brainrot-meter";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your Braintech",
  robots: { index: false, follow: false },
};

type Op = { type?: string; config?: string; section_type?: string; values?: Record<string, string> };
type Client = { hostname?: string; ip?: string; mac?: string; connected?: boolean };
type Telemetry = {
  firmware?: string;
  uptime_sec?: number;
  wan_up?: boolean;
  clients?: Client[];
};
type DeviceRow = {
  device_id: string;
  label: string | null;
  mac: string | null;
  desired: Op[] | null;
  desired_version: number;
  reported_version: number;
  last_status: string | null;
  last_seen: string | null;
  telemetry: Telemetry | null;
};
type LabelRow = { mac: string; name: string };
type ActiveRule = {
  rule_id: string;
  name: string;
  rule_type: string;
  summary: string | null;
  params: Record<string, unknown> | null;
};
type GroupRow = {
  group_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
};

function online(lastSeen: string | null): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < 120_000; // 2 min
}

function fmtUptime(s?: number): string {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function realClients(t: Telemetry | null): Client[] {
  return (t?.clients ?? []).filter((c) => c.ip && !c.ip.startsWith("fe80"));
}

export default async function Dashboard() {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) redirect("/login");

  const sql = getSql();
  let devices: DeviceRow[] = [];
  let labels = new Map<string, string>();
  let activeRules: ActiveRule[] = [];
  let groups: GroupRow[] = [];
  let macGroups = new Map<string, string[]>();
  let allDevices: Awaited<ReturnType<typeof loadAllDevices>> = [];
  let memory = "";
  if (sql) {
    await ensureDeviceSchema(sql);
    await ensureAccountSchema(sql);
    await ensureDefaultGroup(sql, email);
    devices = (await sql`
      SELECT device_id, label, mac, desired, desired_version, reported_version, last_status, last_seen, telemetry
      FROM devices WHERE owner_email = ${email} ORDER BY created_at;
    `) as DeviceRow[];
    const labelRows = (await sql`
      SELECT mac, name FROM client_labels WHERE owner_email = ${email};
    `) as LabelRow[];
    labels = new Map(labelRows.map((l) => [l.mac.toLowerCase(), l.name]));
    activeRules = (await sql`
      SELECT rule_id, name, rule_type, summary, params FROM account_rules
      WHERE owner_email = ${email} AND active = TRUE ORDER BY created_at;
    `) as ActiveRule[];
    groups = (await sql`
      SELECT group_id, name, description, is_default FROM account_groups
      WHERE owner_email = ${email} ORDER BY is_default DESC, created_at;
    `) as GroupRow[];
    macGroups = await loadMacGroups(sql, email);
    allDevices = await loadAllDevices(sql, email);
    const leadRows = (await sql`SELECT memory FROM leads WHERE email = ${email};`) as {
      memory: string | null;
    }[];
    memory = leadRows[0]?.memory ?? "";
  }

  // Bucket active rules by the group they target (pause_group → params.group_id).
  const rulesByGroup = new Map<string, ActiveRule[]>();
  for (const r of activeRules) {
    if (r.rule_type !== "pause_group") continue;
    const gid = (r.params as { group_id?: string } | null)?.group_id;
    if (!gid) continue;
    const list = rulesByGroup.get(gid) ?? [];
    list.push(r);
    rulesByGroup.set(gid, list);
  }

  // Shape for the new tab system. brainrot_minutes is null until
  // /api/account/usage starts returning real category data.
  const allDevicesUI = allDevices.map((d) => ({ ...d, brainrot_minutes: null }));
  const groupsForUi = groups.map((g) => {
    const rules = (rulesByGroup.get(g.group_id) ?? []).map((r) => ({
      rule_id: r.rule_id,
      rule_type: r.rule_type,
      name: r.name,
      summary: r.summary,
    }));
    return {
      group_id: g.group_id,
      name: g.name,
      is_default: g.is_default,
      rule_count: rules.length,
      rules,
      brainrot_minutes: null,
    };
  });
  // Unused references retained intentionally — proxy.ts cookies + macGroups
  // are still set above for future use (e.g. usage attribution).
  void macGroups;
  void labels;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 py-6 sm:py-10">
      <SWRegister />

      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={32} height={32} className="size-8 rounded-md" />
          <span className="font-semibold tracking-tight">braintech</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-[var(--color-ink-soft)]">
          <span className="hidden sm:inline">{email}</span>
          <LogoutButton />
        </div>
      </header>

      {/* Devices & network status */}
      <section>
        <h2 className="serif text-2xl tracking-[-0.01em]">Your network</h2>
        {devices.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-[var(--color-rule)] bg-white p-5 text-[var(--color-ink-soft)]">
            No device linked to {email} yet. Once your Braintech device is registered to your
            account, its status appears here.
          </div>
        ) : (
          <div className="mt-3 grid gap-3">
            {devices.map((d) => {
              const isOnline = online(d.last_seen);
              const inSync = d.reported_version === d.desired_version;
              return (
                <div key={d.device_id} className="rounded-2xl border border-[var(--color-rule)] bg-white p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-medium">
                      <span className={`size-2.5 rounded-full ${isOnline ? "bg-emerald-500" : "bg-zinc-300"}`} />
                      {d.label ?? d.device_id}
                    </div>
                    <span className="text-xs text-[var(--color-ink-soft)]">{isOnline ? "Online" : "Offline"}</span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <Stat label="Config" value={inSync ? "In sync ✓" : "Updating…"} />
                    <Stat label="WAN" value={d.telemetry?.wan_up ? "Up" : "Down"} />
                    <Stat label="Firmware" value={d.telemetry?.firmware ?? "—"} />
                    <Stat label="Uptime" value={fmtUptime(d.telemetry?.uptime_sec)} />
                    <Stat label="Connected" value={`${realClients(d.telemetry).length} devices`} />
                    <Stat label="Rules active" value={String(activeRules.length)} />
                  </dl>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* USAGE — dashboard headline. Brainrot meter + category placeholders.
          Real category data turns this on once /api/account/usage exists. */}
      <section>
        <h2 className="serif text-2xl tracking-[-0.01em]">Usage</h2>
        <div className="mt-3 rounded-2xl border border-[var(--color-rule)] bg-white p-5">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
            <BrainrotMeter minutes={null} size="lg" />
            <div className="flex-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { k: "Social", warm: true },
                { k: "Video", warm: true },
                { k: "Games", warm: true },
                { k: "Learning", warm: false },
              ].map((c) => (
                <div
                  key={c.k}
                  className="rounded-lg bg-[var(--color-cream)] p-3 text-center"
                >
                  <div
                    className={`text-[10px] font-medium uppercase tracking-wider ${
                      c.warm
                        ? "text-[var(--color-accent)]"
                        : "text-emerald-700"
                    }`}
                  >
                    {c.k}
                  </div>
                  <div className="mt-1 font-mono text-base">—</div>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-4 text-xs text-[var(--color-ink-soft)]">
            Last 24h. Brain mark goes green when the household stays under
            10 minutes a day of short-form video / social. Per-category data
            turns on once your Braintech device streams telemetry.
          </p>
        </div>
      </section>

      {/* DEVICES — one unified table. Tabs = groups, "+" creates one,
          selecting a group reveals its rules + add device + add rule. */}
      {devices.length > 0 && (
        <section>
          <h2 className="serif text-2xl tracking-[-0.01em]">Devices</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            Every screen seen on your network in the last 7 days. Groups
            are subsets — tap a tab to filter, manage members and rules
            inside the group.
          </p>
          <AllDevicesSection rows={allDevicesUI} groups={groupsForUi} />
        </section>
      )}

      {memory && (
        <section>
          <div className="rounded-2xl border border-[var(--color-rule)] bg-white p-4 text-sm text-[var(--color-ink-soft)]">
            <span className="font-medium text-[var(--color-ink)]">What Bri knows: </span>
            {memory}
          </div>
        </section>
      )}

      {/* Bri */}
      <section className="pb-4">
        <h2 className="serif text-2xl tracking-[-0.01em]">Chat with Bri</h2>
        <div className="mt-3">
          <AccountChat />
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="mt-0.5 font-medium text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}
