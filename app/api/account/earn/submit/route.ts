/**
 * Kid submits answers, server scores via Claude, grants credit on pass.
 *
 * Auth: derives owner from the claim's stored mac (we trust that the
 * kid is hitting this from the same device that started the claim,
 * because no one else has the claim_id). No parent login required.
 *
 * On pass (3/3): grant credit_pass minutes via the shared grantCredit
 *   helper — which also re-materializes active schedule rules so the
 *   on-device engine sees the new balance.
 * On partial (2/3): grant credit_partial minutes (smaller).
 * On fail (0–1/3): no credit, kind feedback.
 *
 * The score, raw answers, feedback, and credit_granted all land on the
 * earn_claims row so a parent can audit later via the dashboard.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getSql,
  ensureDeviceSchema,
  ensureAccountSchema,
} from "@/app/lib/db";
import { scoreQuiz, ACTIVITIES, type ActivityType } from "@/app/lib/earn";
import { grantCredit, rematerializePolicies } from "@/app/lib/credit-grant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: { claim_id?: string; answers?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid json" }, { status: 400 });
  }
  const claimId = String(body.claim_id ?? "").trim();
  if (!/^claim_[a-f0-9]{8,}$/.test(claimId)) {
    return NextResponse.json({ ok: false, reason: "bad claim_id" }, { status: 400 });
  }
  if (!Array.isArray(body.answers) || body.answers.length !== 3) {
    return NextResponse.json({ ok: false, reason: "answers must be 3 strings" }, { status: 400 });
  }
  const answers = body.answers.map((a) => String(a ?? "").slice(0, 1200).trim());

  const sql = getSql();
  if (!sql) return NextResponse.json({ ok: false, reason: "unavailable" }, { status: 503 });
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);

  const rows = (await sql`
    SELECT owner_email, mac, activity_type, subject, questions, scored_at
    FROM earn_claims WHERE claim_id = ${claimId};
  `) as {
    owner_email: string;
    mac: string;
    activity_type: string;
    subject: string;
    questions: { q: string }[];
    scored_at: string | null;
  }[];
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, reason: "claim not found" }, { status: 404 });
  }
  const claim = rows[0];
  if (claim.scored_at) {
    return NextResponse.json(
      { ok: false, reason: "already scored" },
      { status: 409 },
    );
  }
  const activity = claim.activity_type as ActivityType;
  if (!(activity in ACTIVITIES)) {
    return NextResponse.json({ ok: false, reason: "bad activity stored" }, { status: 500 });
  }

  let result;
  try {
    result = await scoreQuiz(activity, claim.subject, claim.questions, answers);
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: "scoring failed", message: (e as Error).message },
      { status: 502 },
    );
  }

  const cfg = ACTIVITIES[activity];
  let granted = 0;
  if (result.passed) granted = cfg.credit_pass;
  else if (result.partial) granted = cfg.credit_partial;

  // Mark scored + close the earn session (if any). For video claims
  // this revokes the punch-through early — the kid is done watching,
  // they shouldn't keep unrestricted access while answering.
  await sql`
    UPDATE earn_claims SET
      answers        = ${JSON.stringify(answers)}::jsonb,
      score          = ${result.score},
      max_score      = ${result.max_score},
      passed         = ${result.passed},
      credit_granted = ${granted},
      scored_at      = NOW(),
      active_until   = NULL
    WHERE claim_id = ${claimId};
  `;

  let newBalance = 0;
  if (granted > 0) {
    const sourceTag =
      `earn_${activity}` as
        | "earn_khan"
        | "earn_reading"
        | "earn_ted"
        | "earn_coding"
        | "earn_video";
    const note = `${cfg.label}: ${claim.subject.slice(0, 80)} (${result.score}/${result.max_score})`;
    const grant = await grantCredit(
      sql,
      claim.owner_email,
      claim.mac,
      granted,
      sourceTag,
      note,
    );
    newBalance = grant.new_balance;
  } else {
    // No grant means grantCredit's rematerialize didn't run, but we still
    // need to push fresh policy so the agent picks up the cleared
    // active_until and resumes enforcement.
    try {
      await rematerializePolicies(sql, claim.owner_email);
    } catch (err) {
      console.error("[earn/submit] rematerialize failed", err);
    }
    const bal = (await sql`
      SELECT balance_minutes FROM brain_credits WHERE owner_email = ${claim.owner_email} AND mac = ${claim.mac};
    `) as { balance_minutes: number }[];
    newBalance = bal[0]?.balance_minutes ?? 0;
  }

  return NextResponse.json({
    ok: true,
    score: result.score,
    max_score: result.max_score,
    passed: result.passed,
    partial: result.partial,
    feedback: result.feedback,
    credit_granted: granted,
    new_balance: newBalance,
  });
}
