import Link from "next/link";
import type { Metadata } from "next";
import { getSql, ensureDeviceSchema, ensureAccountSchema } from "@/app/lib/db";
import { resolveMacToPerson, type Person } from "@/app/lib/persons";
import { RegisterForm } from "./register-form";

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

type SiblingDevice = {
  mac: string;
  label: string | null;
  is_me: boolean;
  seen_recently: boolean;
};

type AvailableGroup = {
  group_id: string;
  name: string;
  // null when the household created the group before the kind field
  // was added (or just never set it). The picker treats every
  // non-default group as a person regardless.
  kind: "kid" | "adult" | null;
};

type MineResponse =
  | {
      ok: true;
      mac: string;
      label: string | null;
      hostname: string | null;
      groups: { group_id: string; name: string }[];
      rules: Rule[];
      seen_recently: boolean;
      // Set when MAC belongs to a kid/adult group — flips the page to
      // the warm portal layout. NULL → either NeedsRegistration (no
      // person yet) or DeviceView (only generic groups).
      person: Person | null;
      // For kid portal: every device in the kid's group with its label,
      // so they can see what's tied to their profile.
      siblings: SiblingDevice[];
      // For kid portal: balance + lifetime earn stats.
      credit_balance: number;
      earn_passed_count: number;
      earn_total_minutes: number;
      // For registration form (only relevant when person is null):
      // existing kid/adult groups in the household the visitor can join.
      available_groups: AvailableGroup[];
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
    SELECT owner_email, last_seen, hostname
    FROM client_last_seen
    WHERE mac = ${mac}
    ORDER BY last_seen DESC
    LIMIT 1;
  `) as { owner_email: string; last_seen: string; hostname: string | null }[];
  if (owners.length === 0) {
    return { ok: false, reason: "device not recognised on any account" };
  }
  const owner = owners[0].owner_email;
  const hostname = owners[0].hostname;
  const seenRecently =
    Date.now() - new Date(owners[0].last_seen).getTime() < 5 * 60 * 1000;

  // Label preference: manually-set label → DHCP-provided hostname → null.
  // Most devices on a fresh setup never get a manual label; the hostname
  // ("ApeTop", "Mayas-iPhone") is what the dashboard's already showing.
  const labelRow = (await sql`
    SELECT name FROM client_labels WHERE owner_email = ${owner} AND mac = ${mac};
  `) as { name: string }[];
  const label = labelRow[0]?.name ?? hostname ?? null;

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

  // Person resolution — kid/adult group means render the warm portal.
  const person = await resolveMacToPerson(sql, owner, mac);

  let siblings: SiblingDevice[] = [];
  let creditBalance = 0;
  let earnPassed = 0;
  let earnMinutes = 0;
  if (person) {
    // Every MAC in this person's group, with labels + recent-seen flag.
    const sibRows = (await sql`
      SELECT cgm.mac::text AS mac,
             COALESCE(cl.name, cls.hostname) AS label,
             cls.last_seen
      FROM client_group_memberships cgm
      LEFT JOIN client_labels cl
        ON cl.owner_email = cgm.owner_email AND cl.mac = cgm.mac
      LEFT JOIN client_last_seen cls
        ON cls.owner_email = cgm.owner_email AND cls.mac = cgm.mac
      WHERE cgm.owner_email = ${owner} AND cgm.group_id = ${person.group_id};
    `) as { mac: string; label: string | null; last_seen: string | null }[];
    siblings = sibRows.map((s) => ({
      mac: s.mac,
      label: s.label,
      is_me: s.mac.toLowerCase() === mac,
      seen_recently:
        !!s.last_seen &&
        Date.now() - new Date(s.last_seen).getTime() < 5 * 60 * 1000,
    }));

    // Balance for the person — stamped on brain_credits via group_id.
    const bal = (await sql`
      SELECT COALESCE(SUM(balance_minutes), 0)::int AS balance
      FROM brain_credits
      WHERE owner_email = ${owner} AND group_id = ${person.group_id};
    `) as { balance: number }[];
    creditBalance = Number(bal[0]?.balance ?? 0);

    const earnRow = (await sql`
      SELECT COUNT(*)::int AS passed,
             COALESCE(SUM(credit_granted), 0)::int AS minutes
      FROM earn_claims
      WHERE owner_email = ${owner}
        AND group_id = ${person.group_id}
        AND passed = TRUE;
    `) as { passed: number; minutes: number }[];
    earnPassed = Number(earnRow[0]?.passed ?? 0);
    earnMinutes = Number(earnRow[0]?.minutes ?? 0);
  }

  // For the self-registration form: every household group is a
  // person (kid, adult, or just a named bucket created before kinds
  // existed). We surface them all here; only the default "All devices"
  // bucket is excluded since that's a system group, not someone.
  let availableGroups: AvailableGroup[] = [];
  if (!person) {
    const ag = (await sql`
      SELECT g.group_id, COALESCE(NULLIF(g.person_name, ''), g.name) AS name, g.kind
      FROM account_groups g
      WHERE g.owner_email = ${owner}
        AND g.is_default = FALSE
      ORDER BY
        CASE g.kind WHEN 'kid' THEN 0 WHEN 'adult' THEN 1 ELSE 2 END,
        g.created_at ASC;
    `) as { group_id: string; name: string; kind: string | null }[];
    availableGroups = ag.map((g) => ({
      group_id: g.group_id,
      name: g.name,
      kind: g.kind === "kid" || g.kind === "adult" ? g.kind : null,
    }));
  }

  return {
    ok: true,
    mac,
    label,
    hostname,
    groups: groupRows,
    rules: visible,
    seen_recently: seenRecently,
    person,
    siblings,
    credit_balance: creditBalance,
    earn_passed_count: earnPassed,
    earn_total_minutes: earnMinutes,
    available_groups: availableGroups,
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
        {!macOk && (
          <>
            <h1 className="serif text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
              Who are you?
            </h1>
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
          </>
        )}

        {data?.ok === false && (
          <>
            <h1 className="serif text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
              Hmm.
            </h1>
            <div className="mt-8 rounded-2xl border border-[var(--color-rule)] bg-white p-5 text-[var(--color-ink-soft)]">
              We couldn&rsquo;t look up this device right now. Try refreshing,
              or sign in at{" "}
              <Link href="/app" className="text-[var(--color-accent)] underline">
                /app
              </Link>{" "}
              to manage rules.
            </div>
          </>
        )}

        {data?.ok === true && data.person ? (
          <KidPortal data={data} />
        ) : null}

        {/* No person yet — first-time visitor on this device. Show the
            self-registration form so they can claim it to a person.
            Falls back to the technical DeviceView if anything goes wrong
            with the registration UX (unlikely with the form mounted,
            but keeps the page renderable). */}
        {data?.ok === true && !data.person ? (
          <RegisterForm
            mac={data.mac}
            defaultLabel={data.label ?? data.hostname ?? ""}
            availableGroups={data.available_groups}
          />
        ) : null}

        {/* Bottom note — only for the kid portal. The registration form
            has its own one-time-setup explainer, so a second
            'sign in to your dashboard' line would be noise. */}
        {data?.ok === true && data.person ? (
          <div className="mt-12 rounded-2xl border border-[var(--color-rule)] bg-[var(--color-cream)]/40 p-5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            <p>
              Want to change something here? Ask a parent — they can adjust
              the rules at{" "}
              <Link
                href="/app"
                className="font-medium text-[var(--color-accent)] hover:underline"
              >
                getbraintech.com/app
              </Link>{" "}
              — or you can ask Bri.
            </p>
          </div>
        ) : null}
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

/**
 * KidPortal — warm header, balance hero, my devices, my rules in plain
 * English. Rendered when the visiting MAC belongs to a kid/adult group.
 */
function KidPortal({
  data,
}: {
  data: Extract<MineResponse, { ok: true }>;
}) {
  const person = data.person!;
  const greet =
    person.kind === "kid" ? "Hi" : person.kind === "adult" ? "Hello" : "Hey";

  return (
    <>
      <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
        Your Braintech
      </div>
      <h1 className="serif mt-3 text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
        {greet}, {person.name}.
      </h1>
      <p className="mt-3 text-base text-[var(--color-ink-soft)]">
        {data.seen_recently
          ? "You're on the home Wi-Fi right now."
          : "Last time you were on the home Wi-Fi, this is what was set up."}
      </p>

      {/* Brain credits hero — the kid's headline number. */}
      <div className="mt-8 overflow-hidden rounded-2xl border border-[var(--color-rule)] bg-white">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 p-6 sm:p-7">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
              Brain credits
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="serif text-5xl tracking-[-0.02em] text-[var(--color-ink)] sm:text-6xl">
                {data.credit_balance}
              </span>
              <span className="text-base text-[var(--color-ink-soft)]">
                min
              </span>
            </div>
            <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
              {data.credit_balance > 0
                ? "Spent automatically when you hit your daily limit."
                : "Earn more by watching a video and passing the quiz."}
            </p>
          </div>
          <Link
            href={`/mine/earn?mac=${data.mac}`}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--color-ink)] px-4 py-2.5 text-sm font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)]"
          >
            🧠 Earn more
            <span aria-hidden>→</span>
          </Link>
        </div>
        {data.earn_passed_count > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-rule)] bg-[var(--color-cream)]/40 px-6 py-3 text-xs text-[var(--color-ink-soft)]">
            <span>
              You&rsquo;ve earned{" "}
              <strong className="text-[var(--color-ink)]">
                {data.earn_total_minutes} min
              </strong>{" "}
              from{" "}
              <strong className="text-[var(--color-ink)]">
                {data.earn_passed_count}{" "}
                {data.earn_passed_count === 1 ? "video" : "videos"}
              </strong>
              .
            </span>
          </div>
        ) : null}
      </div>

      {/* My devices */}
      <div className="mt-8">
        <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
          Your devices
        </div>
        <ul className="mt-3 space-y-2">
          {data.siblings.map((s) => (
            <li
              key={s.mac}
              className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--color-rule)] bg-white px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-[var(--color-ink)]">
                  {s.label ?? s.mac}
                  {s.is_me ? (
                    <span className="ml-2 rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">
                      this one
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 font-mono text-xs text-[var(--color-ink-soft)]">
                  {s.mac}
                </div>
              </div>
              <span
                className={
                  "shrink-0 text-xs font-medium uppercase tracking-wider " +
                  (s.seen_recently
                    ? "text-emerald-700"
                    : "text-[var(--color-ink-soft)]")
                }
              >
                {s.seen_recently ? "Online" : "Offline"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* My rules — in plain English */}
      <div className="mt-8">
        <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-soft)]">
          Your rules
        </div>
        {data.rules.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-[var(--color-rule)] bg-white p-5 text-[var(--color-ink-soft)]">
            No rules are limiting you right now. 👍
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
                {r.summary ? (
                  <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">
                    {r.summary}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/**
 * DeviceView — the original technical layout, used for MACs not tied to
 * a kid/adult group (IoT, guest devices, family-shared things without
 * person attribution).
 */
function DeviceView({
  data,
}: {
  data: Extract<MineResponse, { ok: true }>;
}) {
  return (
    <>
      <div className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-accent)]">
        This device on the home Wi-Fi
      </div>
      <h1 className="serif mt-4 text-4xl leading-[1.05] tracking-[-0.02em] sm:text-5xl">
        What&rsquo;s set up here.
      </h1>

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
            Nothing is being filtered for this device right now. Normal
            internet, no rules in place. 👍
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
  );
}
