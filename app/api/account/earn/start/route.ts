/**
 * Kid-initiated quiz generation.
 *
 * Auth model: identifies the kid's device by MAC (passed in the body),
 * verifies the MAC has been seen on some account, generates the quiz,
 * stores the claim row. No parent login required — this endpoint is
 * hit by a kid on their own device via /mine/earn.
 *
 * Rate limit: max 6 claims per MAC per day, regardless of pass/fail.
 * Prevents quiz spam from a kid trying to brute-force credit.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import {
  getSql,
  ensureDeviceSchema,
  ensureAccountSchema,
} from "@/app/lib/db";
import { generateQuiz, ACTIVITIES, type ActivityType } from "@/app/lib/earn";
import { videoById, VIDEO_CATALOG } from "@/app/lib/video-catalog";
import { resolveMacToPerson, loadWatchedVideoIds } from "@/app/lib/persons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_CLAIMS_PER_DAY = 6;

export async function POST(req: NextRequest) {
  let body: { mac?: string; activity?: string; subject?: string; video_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid json" }, { status: 400 });
  }
  const mac = (body.mac ?? "").toLowerCase().trim();
  if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac)) {
    return NextResponse.json({ ok: false, reason: "bad mac" }, { status: 400 });
  }
  const activity = String(body.activity ?? "") as ActivityType;
  if (!(activity in ACTIVITIES)) {
    return NextResponse.json({ ok: false, reason: "bad activity" }, { status: 400 });
  }
  // For video activity: the catalog video supplies the subject + credit
  // amounts. For everything else: the kid types a subject.
  let subject: string;
  let video: ReturnType<typeof videoById> = undefined;
  if (activity === "video") {
    video = videoById(String(body.video_id ?? ""));
    if (!video) {
      return NextResponse.json({ ok: false, reason: "video not in catalog" }, { status: 400 });
    }
    subject = `${video.title} — ${video.speaker}`;
  } else {
    subject = String(body.subject ?? "").trim().slice(0, 200);
    if (subject.length < 2) {
      return NextResponse.json({ ok: false, reason: "subject too short" }, { status: 400 });
    }
  }

  const sql = getSql();
  if (!sql) return NextResponse.json({ ok: false, reason: "unavailable" }, { status: 503 });
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);

  const owners = (await sql`
    SELECT owner_email FROM client_last_seen WHERE mac = ${mac}
    ORDER BY last_seen DESC LIMIT 1;
  `) as { owner_email: string }[];
  if (owners.length === 0) {
    return NextResponse.json({ ok: false, reason: "unknown device" }, { status: 404 });
  }
  const email = owners[0].owner_email;

  // Rate limit. Counts ALL today's claims (pass + fail + abandoned),
  // not just successful ones — failing the quiz and retrying with the
  // same subject is the obvious gaming attempt.
  const counted = (await sql`
    SELECT COUNT(*)::int AS n FROM earn_claims
    WHERE owner_email = ${email} AND mac = ${mac}
      AND created_at >= DATE_TRUNC('day', NOW());
  `) as { n: number }[];
  if ((counted[0]?.n ?? 0) >= MAX_CLAIMS_PER_DAY) {
    return NextResponse.json(
      { ok: false, reason: "rate limit", message: `You've already claimed ${MAX_CLAIMS_PER_DAY} times today — try again tomorrow.` },
      { status: 429 },
    );
  }

  // Self-hosted videos play from our Blob bucket on the same origin as
  // the page — YouTube can stay blocked the whole time. No earn-session
  // punch-through, no 30-second policy-push wait. active_until stays NULL.
  const person = await resolveMacToPerson(sql, email, mac);

  // Server-side duplicate guard: each video earns credit once per person.
  // "Already earned" = a previous claim that PASSED the quiz; failed or
  // abandoned attempts don't lock the video, so the kid can start fresh
  // from the beginning. Matches loadWatchedVideoIds.
  if (video && person) {
    const dup = (await sql`
      SELECT 1 FROM earn_claims
      WHERE owner_email = ${email} AND group_id = ${person.group_id}
        AND video_id = ${video.id} AND passed = TRUE
      LIMIT 1;
    `) as { "?column?": number }[];
    if (dup.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          reason: "already watched",
          message: "You already earned credit for this one — pick a different video to earn more.",
        },
        { status: 409 },
      );
    }
  }

  let questions;
  try {
    questions = await generateQuiz(
      activity,
      subject,
      video
        ? { title: video.title, speaker: video.speaker, source: video.source }
        : undefined,
      person?.age ?? null,
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: "generator failed", message: (e as Error).message },
      { status: 502 },
    );
  }

  const claimId = `claim_${randomBytes(6).toString("hex")}`;

  await sql`
    INSERT INTO earn_claims (
      claim_id, owner_email, mac, activity_type, subject, questions,
      group_id, video_id
    )
    VALUES (
      ${claimId}, ${email}, ${mac}, ${activity}, ${subject},
      ${JSON.stringify(questions)}::jsonb,
      ${person?.group_id ?? null}, ${video?.id ?? null}
    );
  `;

  return NextResponse.json({
    ok: true,
    claim_id: claimId,
    questions,
    activity,
    activity_label: ACTIVITIES[activity].label,
    // For video activity: use the per-video values (longer talks earn more).
    credit_pass: video?.credit_pass ?? ACTIVITIES[activity].credit_pass,
    credit_partial: video?.credit_partial ?? ACTIVITIES[activity].credit_partial,
    // For the video player: serve straight from our Blob bucket.
    asset_url: video?.asset_url,
    duration_seconds: video?.duration_seconds,
    person: person ? { name: person.name, kind: person.kind } : null,
  });
}

// GET: kid hits this on /mine/earn → returns the curated catalog so the
// picker can render thumbnails + durations + credit amounts. Public; no
// auth required (the catalog isn't sensitive).
//
// Optional ?mac=<mac> decorates each entry with `watched: bool` based on
// the group the MAC belongs to — gives the picker the "✓ watched" badge.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mac = (url.searchParams.get("mac") ?? "").toLowerCase().trim();

  let watched = new Set<string>();
  let person: { name: string; kind: "kid" | "adult" | null } | null = null;
  if (/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac)) {
    const sql = getSql();
    if (sql) {
      try {
        await ensureDeviceSchema(sql);
        await ensureAccountSchema(sql);
        const owners = (await sql`
          SELECT owner_email FROM client_last_seen WHERE mac = ${mac}
          ORDER BY last_seen DESC LIMIT 1;
        `) as { owner_email: string }[];
        if (owners.length > 0) {
          const email = owners[0].owner_email;
          const p = await resolveMacToPerson(sql, email, mac);
          if (p) {
            person = { name: p.name, kind: p.kind };
            watched = await loadWatchedVideoIds(sql, email, p.group_id);
          }
        }
      } catch (err) {
        console.error("[earn/start GET] decorate failed", err);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    person,
    videos: VIDEO_CATALOG.map((v) => ({
      id: v.id,
      title: v.title,
      speaker: v.speaker,
      source: v.source,
      youtube_id: v.youtube_id,
      duration_seconds: v.duration_seconds,
      asset_url: v.asset_url,
      blurb: v.blurb,
      topics: v.topics,
      age_min: v.age_min,
      credit_pass: v.credit_pass,
      credit_partial: v.credit_partial,
      watched: watched.has(v.id),
    })),
  });
}
