import Link from "next/link";
import type { Metadata } from "next";
import { getSql, ensureDeviceSchema, ensureAccountSchema } from "@/app/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "What's set up on this device",
  description:
    "See what your home Braintech device has blocked or paused on this connection.",
  robots: { index: false, follow: false },
};

type Rule = {
  rule_id: string;
  rule_type: string;
  name: string;
  summary: string | null;
  scope: "device" | "group" | "network";
  group_name?: string;
};

type MineResponse =
  | {
      ok: true;
      mac: string;
      label: string | null;
      groups: { group_id: string; name: string }[];
      rules: Rule[];
      seen_recently: boolean;
    }
  | { ok: false; reason: string };

const GROUP_SCOPED = new Set(["pause_group", "block_brainrot_group"]);
const DEVICE_SCOPED = new Set(["pause_device"]);

/**
 * Server-side lookup of a MAC's owner + active rules. Same logic as the
 * /api/account/mine endpoint, inlined here so the page doesn't have to
 * round-trip through Vercel's per-deploy URL (which can be access-gated)
 * to fetch its own JSON.
 */
async function lookupMine(mac: string): Promise<MineResponse> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: "unavailable" };
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);

  const owners = (await sql`
    SELECT owner_email, last_seen
    FROM client_last_seen
    WHERE mac = ${mac}
    ORDER BY last_seen DESC
    LIMIT 1;
  `) as { owner_email: string; last_seen: string }[];
  if (owners.length === 0) {
    return { ok: false, reason: "device not recognised on any account" };
  }
  const owner = owners[0].owner_email;
  const seenRecently =
    Date.now() - new Date(owners[0].last_seen).getTime() < 5 * 60 * 1000;

  const labelRow = (await sql`
    SELECT name FROM client_labels WHERE owner_email = ${owner} AND mac = ${mac};
  `) as { name: string }[];
  const label = labelRow[0]?.name ?? null;

  const groupRows = (await sql`
    SELECT g.group_id, g.name
    FROM client_group_memberships m
    JOIN account_groups g
      ON g.group_id = m.group_id AND g.owner_email = m.owner_email
    WHERE m.owner_email = ${owner} AND m.mac = ${mac};
  `) as { group_id: string; name: string }[];
  const groupIds = new Set(groupRows.map((g) => g.group_id));
  const groupNameById = new Map(groupRows.map((g) => [g.group_id, g.name]));

  const ruleRows = (await sql`
    SELECT rule_id, rule_type, name, summary, params
    FROM account_rules
    WHERE owner_email = ${owner} AND active = TRUE;
  `) as {
    rule_id: string;
    rule_type: string;
    name: string;
    summary: string | null;
    params: Record<string, unknown>;
  }[];

  const visible: Rule[] = [];
  for (const r of ruleRows) {
    if (DEVICE_SCOPED.has(r.rule_type)) {
      if (String(r.params.mac ?? "").toLowerCase() === mac) {
        visible.push({
          rule_id: r.rule_id,
          rule_type: r.rule_type,
          name: r.name,
          summary: r.summary,
          scope: "device",
        });
      }
    } else if (GROUP_SCOPED.has(r.rule_type)) {
      const gid = String(r.params.group_id ?? "");
      if (groupIds.has(gid)) {
        visible.push({
          rule_id: r.rule_id,
          rule_type: r.rule_type,
          name: r.name,
          summary: r.summary,
          scope: "group",
          group_name: groupNameById.get(gid),
        });
      }
    } else {
      visible.push({
        rule_id: r.rule_id,
        rule_type: r.rule_type,
        name: r.name,
        summary: r.summary,
        scope: "network",
      });
    }
  }

  return {
    ok: true,
    mac,
    label,
    groups: groupRows,
    rules: visible,
    seen_recently: seenRecently,
  };
}

export default async function MinePage({
  searchParams,
}: {
  searchParams?: Promise<{ mac?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const macRaw = (sp.mac ?? "").trim().toLowerCase();
  const macOk = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(macRaw);

  const data = macOk ? await lookupMine(macRaw) : null;

  return (
    <main className="flex min-h-screen flex-col">
      <nav className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Braintech"
            width={28}
            height={28}
            className="size-7 rounded-md"
          />
          <span className="font-semibold tracking-tight">braintech</span>
        </Link>
      </nav>

      <section className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 sm:py-14">
        <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
          This device on the home Wi-Fi
        </div>
        <h1 className="serif mt-4 text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
          What&rsquo;s set up here.
        </h1>

        {!macOk && (
          <div className="mt-8 rounded-2xl border border-[var(--color-rule)] bg-white p-5">
            <p className="text-[var(--color-ink-soft)]">
              We couldn&rsquo;t identify this device. Try typing{" "}
              <code className="rounded bg-[var(--color-cream)] px-1.5 py-0.5 text-sm">
                http://brain
              </code>{" "}
              from a device on your home Wi-Fi — the Braintech box will
              redirect you back here with the right device.
            </p>
          </div>
        )}

        {data?.ok === false && (
          <div className="mt-8 rounded-2xl border border-[var(--color-rule)] bg-white p-5 text-[var(--color-ink-soft)]">
            We couldn&rsquo;t look up this device right now. Try refreshing,
            or sign in at{" "}
            <Link href="/app" className="text-[var(--color-accent)] underline">
              /app
            </Link>{" "}
            to manage rules.
          </div>
        )}

        {data?.ok === true && (
          <>
            {/* Identity */}
            <div className="mt-8 rounded-2xl border border-[var(--color-rule)] bg-white p-5">
              <div className="flex items-baseline justify-between gap-3">
                <div className="font-semibold text-[var(--color-ink)]">
                  {data.label ?? "Unnamed device"}
                </div>
                <span
                  className={`text-xs font-medium uppercase tracking-wider ${
                    data.seen_recently
                      ? "text-emerald-700"
                      : "text-[var(--color-ink-soft)]"
                  }`}
                >
                  {data.seen_recently ? "Connected now" : "Recently seen"}
                </span>
              </div>
              <div className="mt-1 font-mono text-xs text-[var(--color-ink-soft)]">
                {data.mac}
              </div>
              {data.groups.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="text-[var(--color-ink-soft)]">In group:</span>
                  {data.groups.map((g) => (
                    <span
                      key={g.group_id}
                      className="rounded-full bg-[var(--color-cream)] px-2 py-0.5 font-medium uppercase tracking-wider"
                    >
                      {g.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Rules affecting this device */}
            <div className="mt-6">
              <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
                What&rsquo;s active for this device
              </div>
              {data.rules.length === 0 ? (
                <div className="mt-3 rounded-2xl border border-[var(--color-rule)] bg-white p-5 text-[var(--color-ink-soft)]">
                  Nothing is being filtered for this device right now.
                  Normal internet, no rules in place. 👍
                </div>
              ) : (
                <ul className="mt-3 space-y-3">
                  {data.rules.map((r) => (
                    <li
                      key={r.rule_id}
                      className="rounded-2xl border border-[var(--color-rule)] bg-white p-5"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold text-[var(--color-ink)]">
                          {r.name}
                        </span>
                        <span className="text-xs uppercase tracking-wider text-[var(--color-ink-soft)]">
                          {scopeLabel(r.scope, r.group_name)}
                        </span>
                      </div>
                      {r.summary && (
                        <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">
                          {r.summary}
                        </p>
                      )}
                      <div className="mt-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-accent)]">
                        {r.rule_type.replace(/_/g, " ")}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {/* Bottom note */}
        <div className="mt-12 rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)]/40 p-5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          <p>
            Want to change something here? Sign in to your dashboard at{" "}
            <Link
              href="/app"
              className="font-medium text-[var(--color-accent)] hover:underline"
            >
              getbraintech.com/app
            </Link>{" "}
            and adjust the rule — or text Bri (&ldquo;unlock YouTube for an
            hour&rdquo; works).
          </p>
        </div>
      </section>

      <footer className="border-t border-[var(--color-rule)] bg-white">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-xs text-[var(--color-ink-soft)]">
          <span>© {new Date().getFullYear()} Braintech</span>
          <div className="flex gap-5">
            <Link href="/" className="hover:text-[var(--color-ink)]">
              Home
            </Link>
            <Link href="/app" className="hover:text-[var(--color-ink)]">
              Dashboard
            </Link>
            <Link href="/blocked" className="hover:text-[var(--color-ink)]">
              Blocked page
            </Link>
            <Link href="/privacy" className="hover:text-[var(--color-ink)]">
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function scopeLabel(scope: Rule["scope"], groupName?: string): string {
  if (scope === "device") return "On this device";
  if (scope === "group" && groupName) return `Via ${groupName} group`;
  if (scope === "group") return "Via group";
  return "Whole network";
}
