import Anthropic from "@anthropic-ai/sdk";
import { ensureSmsSchema, getSql } from "@/app/lib/db";
import { verifyTwilioSignature, twiml } from "@/app/lib/twilio";
import { runConversationTurn, type Profile } from "@/app/lib/conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XML_HEADERS = { "Content-Type": "text/xml; charset=utf-8" };

export async function POST(req: Request) {
  const raw = await req.text();
  const form = new URLSearchParams(raw);
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = v));

  const from = params.From ?? "";
  const body = (params.Body ?? "").trim();

  // Verify the request really came from Twilio.
  const signature = req.headers.get("x-twilio-signature");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "";
  const url = process.env.SMS_PUBLIC_URL ?? `${proto}://${host}/api/sms`;
  if (!verifyTwilioSignature(signature, url, params)) {
    console.error("[sms] invalid Twilio signature", { url, from });
    return new Response("Forbidden", { status: 403 });
  }

  if (!from || !body) {
    return new Response(twiml("Sorry, I didn't catch that."), {
      headers: XML_HEADERS,
    });
  }

  const sql = getSql();
  if (!sql) {
    return new Response(
      twiml("We're having a hiccup on our end — try again in a bit!"),
      { headers: XML_HEADERS },
    );
  }

  try {
    await ensureSmsSchema(sql);

    // Ensure a user row exists and load known facts.
    const userRows = (await sql`
      INSERT INTO sms_users (phone)
      VALUES (${from})
      ON CONFLICT (phone) DO UPDATE SET updated_at = NOW()
      RETURNING parent_name, num_kids, kids_ages, goal, notes, interview_complete;
    `) as Profile[];
    const knownProfile: Profile = userRows[0] ?? {};

    // Log the inbound message.
    await sql`
      INSERT INTO sms_messages (phone, direction, body)
      VALUES (${from}, 'inbound', ${body});
    `;

    // Load recent conversation history (oldest first), cap to last 20.
    const rows = (await sql`
      SELECT direction, body FROM sms_messages
      WHERE phone = ${from}
      ORDER BY created_at DESC, id DESC
      LIMIT 20;
    `) as { direction: string; body: string }[];
    const history: Anthropic.MessageParam[] = rows
      .reverse()
      .map((r) => ({
        role: r.direction === "inbound" ? "user" : "assistant",
        content: r.body,
      }));

    const { reply, profile } = await runConversationTurn({
      history,
      knownProfile,
      saveProfile: async (p) => {
        await sql`
          UPDATE sms_users SET
            parent_name = COALESCE(${p.parent_name ?? null}, parent_name),
            num_kids = COALESCE(${p.num_kids ?? null}, num_kids),
            kids_ages = COALESCE(${p.kids_ages ?? null}, kids_ages),
            goal = COALESCE(${p.goal ?? null}, goal),
            notes = COALESCE(${p.notes ?? null}, notes),
            interview_complete = COALESCE(${p.interview_complete ?? null}, interview_complete),
            updated_at = NOW()
          WHERE phone = ${from};
        `;
      },
    });

    // Log the outbound reply.
    await sql`
      INSERT INTO sms_messages (phone, direction, body)
      VALUES (${from}, 'outbound', ${reply});
    `;

    void profile;
    return new Response(twiml(reply), { headers: XML_HEADERS });
  } catch (err) {
    console.error("[sms] handler error", err);
    return new Response(
      twiml("Sorry, something glitched on my end — mind sending that again?"),
      { headers: XML_HEADERS },
    );
  }
}
