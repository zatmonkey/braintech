import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { getSql, ensureChatSchema, ensureSmsSchema } from "@/app/lib/db";
import { runDemoChatTurn } from "@/app/lib/conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MSG_LEN = 600;
const MAX_TURNS = 40; // soft cap per session to bound cost

export async function POST(req: Request) {
  let body: { sessionId?: string; message?: string };
  try {
    body = (await req.json()) as { sessionId?: string; message?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sessionId = (body.sessionId ?? "").trim().slice(0, 80);
  const message = (body.message ?? "").trim().slice(0, MAX_MSG_LEN);
  if (!sessionId || !message) {
    return NextResponse.json({ error: "Missing input" }, { status: 400 });
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json(
      { reply: "We're having a hiccup on our end — try again in a moment!" },
      { status: 200 },
    );
  }

  try {
    await ensureChatSchema(sql);
    await ensureSmsSchema(sql); // ensures the shared `leads` table exists

    const sessionRows = (await sql`
      INSERT INTO chat_sessions (session_id)
      VALUES (${sessionId})
      ON CONFLICT (session_id) DO UPDATE SET updated_at = NOW()
      RETURNING memory;
    `) as { memory: string | null }[];
    const currentMemory = sessionRows[0]?.memory ?? "";

    const countRows = (await sql`
      SELECT COUNT(*)::int AS n FROM chat_messages WHERE session_id = ${sessionId};
    `) as { n: number }[];
    if ((countRows[0]?.n ?? 0) > MAX_TURNS * 2) {
      return NextResponse.json({
        reply:
          "This has been great! Drop your email and the team will pick it up with you directly — I don't want to keep you all day. 🙂",
      });
    }

    await sql`
      INSERT INTO chat_messages (session_id, role, content)
      VALUES (${sessionId}, 'user', ${message});
    `;

    const rows = (await sql`
      SELECT role, content FROM chat_messages
      WHERE session_id = ${sessionId}
      ORDER BY created_at DESC, id DESC
      LIMIT 20;
    `) as { role: string; content: string }[];
    const history: Anthropic.MessageParam[] = rows
      .reverse()
      .map((r) => ({
        role: r.role === "user" ? "user" : "assistant",
        content: r.content,
      }));

    const { reply } = await runDemoChatTurn({
      history,
      currentMemory,
      save: async ({ memory, email, complete }) => {
        await sql`
          UPDATE chat_sessions SET
            memory = ${memory},
            email = COALESCE(${email ?? null}, email),
            updated_at = NOW()
          WHERE session_id = ${sessionId};
        `;
        // If they shared an email, fold this discovery into the unified leads table.
        if (email) {
          await sql`
            INSERT INTO leads (email, memory, interview_complete)
            VALUES (${email}, ${memory}, ${complete})
            ON CONFLICT (email) DO UPDATE SET
              memory = EXCLUDED.memory,
              interview_complete = leads.interview_complete OR EXCLUDED.interview_complete,
              updated_at = NOW();
          `;
        }
      },
    });

    await sql`
      INSERT INTO chat_messages (session_id, role, content)
      VALUES (${sessionId}, 'assistant', ${reply});
    `;

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("[chat] error", err);
    return NextResponse.json({
      reply: "Sorry — I glitched for a second. Mind sending that again?",
    });
  }
}
