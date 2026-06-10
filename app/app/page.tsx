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
import {
  loadMacGroups,
  loadAllDevices,
  loadBrainrotMinutes,
  loadTopAppsByMac,
  sumAppMinutes,
  type AppMinutes,
} from "@/app/lib/groups";
import {
  SWRegister,
  LogoutButton,
  AccountChat,
  AllDevicesSection,
  NetworkStatusCard,
  UsagePanel,
} from "./dashboard-client";
import { InstallPrompt } from "./install-prompt";
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
  let brainrotByMac = new Map<string, number>();
  let appsByMac = new Map<string, AppMinutes[]>();
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
    brainrotByMac = await loadBrainrotMinutes(sql, email);
    appsByMac = await loadTopAppsByMac(sql, email);
    const leadRows = (await sql`SELECT memory FROM leads WHERE email = ${email};`) as {
      memory: string | null;
    }[];
    memory = leadRows[0]?.memory ?? "";
  }

  // Bucket active rules by the group they target. Any rule_type whose
  // params include group_id counts here — currently pause_group +
  // block_brainrot_group. Network-wide types (block_domains_network,
  // force_router_dns, block_managed_list, block_ip_set) intentionally
  // don't bucket — they apply to everyone, not a specific group.
  const rulesByGroup = new Map<string, ActiveRule[]>();
  for (const r of activeRules) {
    if (
      r.rule_type !== "pause_group" &&
      r.rule_type !== "block_brainrot_group" &&
      r.rule_type !== "block_schedule_group"
    ) {
      continue;
    }
    const gid = (r.params as { group_id?: string } | null)?.group_id;
    if (!gid) continue;
    const list = rulesByGroup.get(gid) ?? [];
    list.push(r);
    rulesByGroup.set(gid, list);
  }

  // Shape for the new tab system. brainrot_minutes comes from the per-MAC
  // map loaded from client_usage_minute (last 24h, distinct minutes with
  // social/video/games queries). null when no data yet — the meter shows "—".
  const allDevicesUI = allDevices.map((d) => ({
    ...d,
    brainrot_minutes: brainrotByMac.get(d.mac) ?? null,
    apps: appsByMac.get(d.mac) ?? [],
  }));
  // Sync status: a rule is "propagating" while the agent hasn't reported
  // the desired_version that contains it. Once reported catches up, it's
  // "active" (i.e. live on the router). v1 simplification: all rules
  // share the device's current sync state — if any rule's deploy is in
  // flight, all show propagating. The dashboard polls every 5s, so the
  // orange-to-red transition happens visibly within seconds of the
  // device's long-poll picking up.
  const primaryDevice = devices[0];
  const allInSync = primaryDevice
    ? primaryDevice.desired_version === primaryDevice.reported_version
    : true;
  const ruleStatus: "propagating" | "active" = allInSync ? "active" : "propagating";

  const groupsForUi = groups.map((g) => {
    const rules = (rulesByGroup.get(g.group_id) ?? []).map((r) => ({
      rule_id: r.rule_id,
      rule_type: r.rule_type,
      name: r.name,
      summary: r.summary,
      status: ruleStatus,
    }));
    // Group minutes = sum of member minutes (treat null as 0; if every member
    // is null, surface null instead of 0 so the meter reads "no data yet").
    const memberMacs = Array.from(macGroups.entries())
      .filter(([, gids]) => gids.includes(g.group_id))
      .map(([mac]) => mac);
    const memberMins = memberMacs.map((m) => brainrotByMac.get(m) ?? null);
    const groupMinutes = memberMins.every((m) => m === null)
      ? null
      : memberMins.reduce((acc: number, m) => acc + (m ?? 0), 0);
    const groupApps = sumAppMinutes(
      ...memberMacs.map((m) => appsByMac.get(m) ?? []),
    );
    return {
      group_id: g.group_id,
      name: g.name,
      is_default: g.is_default,
      rule_count: rules.length,
      rules,
      brainrot_minutes: groupMinutes,
      apps: groupApps,
    };
  });
  // Household minutes for the top-of-page Usage meter.
  const householdMinutes =
    allDevicesUI.length === 0
      ? null
      : allDevicesUI.every((d) => d.brainrot_minutes === null)
        ? null
        : allDevicesUI.reduce(
            (acc, d) => acc + (d.brainrot_minutes ?? 0),
            0,
          );
  const householdApps = sumAppMinutes(...allDevicesUI.map((d) => d.apps));
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

      {/* Install hint — only renders for mobile visitors not already in
          standalone PWA mode. Dismissible + remembers the choice. */}
      <InstallPrompt />

      {/* USAGE — dashboard headline. Now a live client component: polls
          /api/account/state on the 60s usage cadence and refreshes
          immediately on Bri's "state-changed" event. */}
      <section>
        <h2 className="serif text-2xl tracking-[-0.01em]">Usage</h2>
        <UsagePanel
          initialMinutes={householdMinutes}
          initialApps={householdApps}
        />
      </section>

      {/* BRI (compact). Lives high so a quick rule is one prompt away. */}
      <section>
        <h2 className="serif text-2xl tracking-[-0.01em]">Bri</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
          Tell her a rule in plain English. She handles the rest.
        </p>
        <div className="mt-3">
          <AccountChat compact />
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

      {/* NETWORK STATUS — bottom of dashboard. Live: polls /api/account/state
          like the Devices section so "Rules active" + "Config" stay
          truthful instead of frozen at page-load time. */}
      <section className="pb-4">
        <h2 className="serif text-2xl tracking-[-0.01em]">Network status</h2>
        <NetworkStatusCard
          ownerEmail={email}
          initial={{
            devices: devices.map((d) => ({
              device_id: d.device_id,
              label: d.label,
              online: online(d.last_seen),
              in_sync: d.reported_version === d.desired_version,
              wan_up: !!d.telemetry?.wan_up,
              firmware: d.telemetry?.firmware ?? null,
              uptime_sec: d.telemetry?.uptime_sec ?? null,
              connected_count: realClients(d.telemetry).length,
            })),
            active_rules: activeRules.length,
          }}
        />
      </section>
    </main>
  );
}

function TopApps({ apps }: { apps: AppMinutes[] }) {
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="mt-0.5 font-medium text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}
