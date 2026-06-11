/**
 * Hourly cron: detect undecided, brainrot-ish apps where a kid has
 * spent meaningful time today, and email the parent a quick OK/Limit
 * decision link.
 *
 * Dedupe via app_alert_log — one nudge per (group, app), reset when
 * the parent (or Bri) records a decision via /api/account/app-classify
 * (which clears the log row).
 *
 * Triggered by Vercel cron (see vercel.json) — auth via the Bearer
 * CRON_SECRET header Vercel injects.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSql, ensureDeviceSchema, ensureAccountSchema } from "@/app/lib/db";
import { loadGroupActivity } from "@/app/lib/activity";
import { sendAppDecisionEmail } from "@/app/lib/email";
import { sendPushToOwner } from "@/app/lib/push";
import { signAppDecisionToken } from "@/app/api/account/app-classify/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_MINUTES_TODAY = 10; // threshold to trigger the nudge

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://getbraintech.com")
  );
}

function decisionUrl(
  base: string,
  email: string,
  group_id: string,
  app: string,
  decision: "ok" | "limit",
): string {
  const token = signAppDecisionToken(email, group_id, app);
  const params = new URLSearchParams({
    email,
    group_id,
    app,
    token,
    decision,
  });
  return `${base}/api/account/app-classify?${params.toString()}`;
}

export async function GET(req: NextRequest) {
  // Vercel cron sends Authorization: Bearer <CRON_SECRET>.
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "db unavailable" }, { status: 503 });
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);

  // Every kid group across every account. (Adults can be added later
  // if the parent ever wants alerts on their own usage.)
  const groups = (await sql`
    SELECT owner_email::text AS owner_email,
           group_id::text AS group_id,
           COALESCE(NULLIF(person_name, ''), name) AS person_name
    FROM account_groups
    WHERE kind = 'kid';
  `) as { owner_email: string; group_id: string; person_name: string }[];

  const base = siteUrl();
  let alertsSent = 0;
  let alertsSkipped = 0;

  for (const g of groups) {
    const apps = await loadGroupActivity(sql, g.owner_email, g.group_id);
    for (const a of apps) {
      // Skip: already decided, below threshold, or not brainrot-ish.
      if (a.status !== null) continue;
      if (a.minutes_today < MIN_MINUTES_TODAY) continue;
      if (a.rollup !== "brainrot") continue;

      // Dedupe: have we already alerted on this (group, app)?
      const prior = (await sql`
        SELECT alerted_at FROM app_alert_log
        WHERE owner_email = ${g.owner_email}
          AND group_id    = ${g.group_id}
          AND app         = ${a.app}
        LIMIT 1;
      `) as { alerted_at: string }[];
      if (prior.length > 0) {
        // Re-alert at most once every 24h if the kid keeps piling on.
        const last = new Date(prior[0].alerted_at).getTime();
        if (Date.now() - last < 24 * 60 * 60 * 1000) {
          alertsSkipped++;
          continue;
        }
      }

      const ok_url = decisionUrl(base, g.owner_email, g.group_id, a.app, "ok");
      const limit_url = decisionUrl(base, g.owner_email, g.group_id, a.app, "limit");
      let anyDelivered = false;
      try {
        const sent = await sendAppDecisionEmail(g.owner_email, {
          person_name: g.person_name,
          app: a.app,
          minutes_today: a.minutes_today,
          minutes_7d: a.minutes_7d,
          rollup: a.rollup,
          ok_url,
          limit_url,
          dashboard_url: `${base}/app`,
        });
        if (sent.delivered) anyDelivered = true;
      } catch (err) {
        console.error("[cron/app-alerts] email send failed", err);
      }
      // Web Push to every PWA installation registered against the owner.
      // Tag by (group, app) so a repeat collapses the notification on
      // the device. Email + push fire together — both can be received,
      // both honor the same alert_log dedupe.
      try {
        const push = await sendPushToOwner(sql, g.owner_email, {
          title: `${g.person_name} on ${a.app}`,
          body: `${a.minutes_today} min today · ${a.minutes_7d} min over 7d. Tap to decide.`,
          url: `/app?classified=${encodeURIComponent(a.app)}`,
          tag: `app-alert:${g.group_id}:${a.app}`,
          data: {
            group_id: g.group_id,
            app: a.app,
            ok_url,
            limit_url,
          },
        });
        if (push.sent > 0) anyDelivered = true;
      } catch (err) {
        console.error("[cron/app-alerts] push send failed", err);
      }

      if (anyDelivered) {
        alertsSent++;
        await sql`
          INSERT INTO app_alert_log (owner_email, group_id, app, minutes_at_alert)
          VALUES (${g.owner_email}, ${g.group_id}, ${a.app}, ${a.minutes_today})
          ON CONFLICT (owner_email, group_id, app) DO UPDATE SET
            alerted_at        = NOW(),
            minutes_at_alert  = EXCLUDED.minutes_at_alert;
        `;
      } else {
        alertsSkipped++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    groups: groups.length,
    sent: alertsSent,
    skipped: alertsSkipped,
  });
}
