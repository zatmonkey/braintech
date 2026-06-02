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
import { loadMacGroups } from "@/app/lib/groups";
import {
  SWRegister,
  LogoutButton,
  AccountChat,
  ClientRow,
  RuleRow,
  GroupsSection,
} from "./dashboard-client";

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

  // Render-time helpers for the Groups section
  const allClients = devices.flatMap((d) => realClients(d.telemetry));
  const knownDevices = allClients
    .filter((c) => c.mac)
    .map((c) => {
      const mac = c.mac!.toLowerCase();
      return { mac, name: labels.get(mac) ?? c.hostname ?? mac };
    });
  const groupsForUi = groups.map((g) => {
    const memberMacs: string[] = [];
    for (const [mac, gids] of macGroups.entries()) {
      if (gids.includes(g.group_id)) memberMacs.push(mac);
    }
    return {
      ...g,
      members: memberMacs.map((mac) => ({
        mac,
        name: labels.get(mac) ?? mac,
      })),
      rules: (rulesByGroup.get(g.group_id) ?? []).map((r) => ({
        rule_id: r.rule_id,
        rule_type: r.rule_type,
        name: r.name,
        summary: r.summary,
      })),
    };
  });

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

      {/* Connected devices */}
      {devices.length > 0 && (
        <section>
          <h2 className="serif text-2xl tracking-[-0.01em]">Connected devices</h2>
          <div className="mt-3 rounded-2xl border border-[var(--color-rule)] bg-white p-5">
            {(() => {
              const clients = devices.flatMap((d) => realClients(d.telemetry));
              if (clients.length === 0)
                return <p className="text-[var(--color-ink-soft)]">No devices reported yet — your Braintech device updates this every minute.</p>;
              return (
                <ul className="divide-y divide-[var(--color-rule)]">
                  {clients.map((c, i) => {
                    const mac = (c.mac ?? "").toLowerCase();
                    return (
                      <ClientRow
                        key={mac || i}
                        ip={c.ip ?? ""}
                        mac={mac}
                        hostname={c.hostname}
                        connected={c.connected}
                        label={mac ? labels.get(mac) : undefined}
                      />
                    );
                  })}
                </ul>
              );
            })()}
          </div>
        </section>
      )}

      {/* Groups */}
      {devices.length > 0 && (
        <section>
          <h2 className="serif text-2xl tracking-[-0.01em]">Groups</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            Bundle devices so rules can target them as a unit. A device can be in multiple groups.
          </p>
          <GroupsSection groups={groupsForUi} knownDevices={knownDevices} />
        </section>
      )}

      {/* Rules summary */}
      <section>
        <h2 className="serif text-2xl tracking-[-0.01em]">Rules</h2>
        <div className="mt-3 rounded-2xl border border-[var(--color-rule)] bg-white p-5">
          {activeRules.length === 0 ? (
            <p className="text-[var(--color-ink-soft)]">
              No rules yet. Tell Bri below what you&apos;d like — e.g. “block TikTok for Maya
              until she reads 20 minutes” — and it&apos;ll set it up on your device.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-rule)]">
              {activeRules.map((r) => (
                <RuleRow
                  key={r.rule_id}
                  ruleId={r.rule_id}
                  name={r.name}
                  ruleType={r.rule_type}
                  summary={r.summary}
                />
              ))}
            </ul>
          )}
          {memory && (
            <p className="mt-4 border-t border-[var(--color-rule)] pt-3 text-sm text-[var(--color-ink-soft)]">
              <span className="font-medium text-[var(--color-ink)]">What Bri knows: </span>
              {memory}
            </p>
          )}
        </div>
      </section>

      {/* Usage */}
      <section>
        <h2 className="serif text-2xl tracking-[-0.01em]">Usage</h2>
        <div className="mt-3 rounded-2xl border border-dashed border-[var(--color-rule)] bg-white p-5">
          <p className="text-[var(--color-ink-soft)]">
            Per-device and per-category usage reporting turns on once your device starts streaming
            telemetry. We&apos;ll show screen time by kid, by device, and by category
            (social, video, games, learning) here.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 opacity-50 sm:grid-cols-4">
            {["Social", "Video", "Games", "Learning"].map((c) => (
              <div key={c} className="rounded-lg bg-[var(--color-cream)] p-3 text-center text-xs">
                <div className="text-[var(--color-ink-soft)]">{c}</div>
                <div className="mt-1 font-mono text-base">—</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--color-ink-soft)]/70">Coming soon</p>
        </div>
      </section>

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
