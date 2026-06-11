/**
 * Parent-facing audit log of a group's passed earn-claims.
 *
 * Used by the group-toolbar "X earned" chip → modal: shows every video
 * the kid watched, their YouTube link (so parent can rewatch), the
 * questions they were asked, and what they answered. Read-only audit;
 * no scoring or edits happen here.
 *
 * Auth: parent session via bt_session cookie, same as the rest of /app.
 * The group_id query param must belong to the authenticated owner.
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import {
  getSql,
  ensureDeviceSchema,
  ensureAccountSchema,
} from "@/app/lib/db";
import { videoById } from "@/app/lib/video-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClaimRow = {
  claim_id: string;
  mac: string;
  activity_type: string;
  subject: string;
  video_id: string | null;
  questions: unknown;
  answers: unknown;
  score: number | null;
  max_score: number | null;
  passed: boolean | null;
  credit_granted: number;
  scored_at: string | null;
  created_at: string;
};

type Question =
  | { q: string; kind?: "open" }
  | { q: string; kind: "mc"; choices: string[]; answer_index: number };

export async function GET(req: NextRequest) {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const groupId = (url.searchParams.get("group_id") ?? "").trim();
  if (!/^grp_[a-f0-9]{6,}$/.test(groupId)) {
    return NextResponse.json({ error: "bad group_id" }, { status: 400 });
  }

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "db unavailable" }, { status: 503 });
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);

  // Ownership check + return all attempts (passed + failed + in-flight)
  // so the parent can audit the full history, not just successes. The
  // group-toolbar chip counts passed only; the modal shows everything.
  const rows = (await sql`
    SELECT c.claim_id, c.mac::text AS mac, c.activity_type, c.subject,
           c.video_id, c.questions, c.answers, c.score, c.max_score,
           c.passed, c.credit_granted, c.scored_at, c.created_at
    FROM earn_claims c
    JOIN account_groups g
      ON g.owner_email = c.owner_email AND g.group_id = c.group_id
    WHERE c.owner_email = ${email}
      AND c.group_id = ${groupId}
    ORDER BY c.created_at DESC
    LIMIT 100;
  `) as ClaimRow[];

  return NextResponse.json({
    ok: true,
    group_id: groupId,
    claims: rows.map((r) => {
      const questions = Array.isArray(r.questions) ? (r.questions as Question[]) : [];
      const answers = Array.isArray(r.answers) ? (r.answers as string[]) : [];
      const video = r.video_id ? videoById(r.video_id) : undefined;
      // Hand back enriched per-question pairs so the modal doesn't have
      // to walk the JSONB itself. For MC questions, surface what the
      // correct answer was AND whether the kid picked it.
      const per_question = questions.map((q, i) => {
        const a = answers[i] ?? "";
        if ((q as { kind?: string }).kind === "mc") {
          const mc = q as {
            q: string;
            choices: string[];
            answer_index: number;
          };
          const correctChoice = mc.choices?.[mc.answer_index] ?? "";
          return {
            kind: "mc" as const,
            question: mc.q,
            choices: mc.choices ?? [],
            correct_choice: correctChoice,
            kid_choice: a,
            correct: a !== "" && (a === correctChoice || a === String(mc.answer_index)),
          };
        }
        return {
          kind: "open" as const,
          question: q.q,
          kid_answer: a,
        };
      });
      return {
        claim_id: r.claim_id,
        mac: r.mac,
        activity_type: r.activity_type,
        subject: r.subject,
        video_id: r.video_id,
        video: video
          ? {
              title: video.title,
              speaker: video.speaker,
              source: video.source,
              youtube_id: video.youtube_id,
              youtube_url: `https://www.youtube.com/watch?v=${video.youtube_id}`,
              duration_seconds: video.duration_seconds,
            }
          : null,
        score: r.score,
        max_score: r.max_score,
        passed: r.passed,
        credit_granted: r.credit_granted,
        created_at: r.created_at,
        scored_at: r.scored_at,
        per_question,
      };
    }),
  });
}
