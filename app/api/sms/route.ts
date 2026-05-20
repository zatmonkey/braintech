import Anthropic from "@anthropic-ai/sdk";
import { ensureSmsSchema, getSql } from "@/app/lib/db";
import { verifyTwilioSignature, twiml } from "@/app/lib/twilio";
import { runConversationTurn } from "@/app/lib/conversation";

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

  // Carrier-compliance keywords. (Twilio Advanced Opt-Out may also handle STOP
  // upstream; this is a defensive fallback so we're always compliant.)
  const keyword = body.trim().toUpperCase();
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(keyword)) {
    return new Response(
      twiml(
        "You're opted out of Braintech texts and won't receive more. Reply START to opt back in.",
      ),
      { headers: XML_HEADERS },
    );
  }
  if (["HELP", "INFO"].includes(keyword)) {
    return new Response(
      twiml(
        "Braintech: parental control by text. Help: braintech.app. Msg&data rates may apply. Reply STOP to opt out.",
      ),
      { headers: XML_HEADERS },
    );
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

    // Resolve the lead by phone. Leads are keyed by email — for a normal
    // waitlist signup the row already exists with this phone. For a cold
    // inbound from an unknown number, create a placeholder keyed on the phone.
    const leadRows = (await sql`
      SELECT email, memory FROM leads
      WHERE phone = ${from}
      ORDER BY updated_at DESC
      LIMIT 1;
    `) as { email: string; memory: string | null }[];

    let email: string;
    let currentMemory: string;
    if (leadRows.length > 0) {
      email = leadRows[0].email;
      currentMemory = leadRows[0].memory ?? "";
    } else {
      email = `${from}@sms.unknown`;
      currentMemory = "";
      await sql`
        INSERT INTO leads (email, phone)
        VALUES (${email}, ${from})
        ON CONFLICT (email) DO UPDATE SET phone = ${from}, updated_at = NOW();
      `;
    }

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

    const { reply } = await runConversationTurn({
      history,
      currentMemory,
      saveMemory: async (memory, complete) => {
        await sql`
          UPDATE leads SET
            memory = ${memory},
            interview_complete = ${complete},
            updated_at = NOW()
          WHERE email = ${email};
        `;
      },
    });

    // Log the outbound reply.
    await sql`
      INSERT INTO sms_messages (phone, direction, body)
      VALUES (${from}, 'outbound', ${reply});
    `;

    return new Response(twiml(reply), { headers: XML_HEADERS });
  } catch (err) {
    console.error("[sms] handler error", err);
    return new Response(
      twiml("Sorry, something glitched on my end — mind sending that again?"),
      { headers: XML_HEADERS },
    );
  }
}
