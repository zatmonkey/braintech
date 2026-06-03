import { NextResponse } from "next/server";
import { getSql, ensureSmsSchema } from "@/app/lib/db";
import { twilioConfigured, sendSms } from "@/app/lib/twilio";
import { generateOpener } from "@/app/lib/conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = {
  email?: string;
  phone?: string;
  source?: string;
  variation?: string;
  smsConsent?: boolean;
};

function normalizeEmail(raw: string) {
  return raw.trim().toLowerCase();
}

function normalizePhone(raw: string) {
  const hadPlus = raw.trim().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  // Explicit country code provided — trust it.
  if (hadPlus) return `+${digits}`;
  // Bare 10-digit number → assume US/Canada (+1). This is a US product.
  if (digits.length === 10) return `+1${digits}`;
  // 11 digits starting with 1 → US/Canada with country code, just add +.
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  // Otherwise assume the digits already include a country code.
  return `+${digits}`;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function notifyWebhook(entry: {
  email: string;
  phone: string;
  source: string;
  variation: string;
  ua: string;
  ip: string;
}) {
  const url = process.env.WAITLIST_WEBHOOK_URL;
  if (!url) return;
  try {
    const isSlack = url.includes("hooks.slack.com");
    const body = isSlack
      ? {
          text: `*New braintech waitlist signup*\n• Email: ${entry.email}\n• Phone: ${entry.phone}\n• Variation: ${entry.variation}\n• Source: ${entry.source}\n• IP: ${entry.ip}`,
        }
      : entry;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("[waitlist] webhook failed", err);
  }
}

async function persistToPostgres(entry: {
  email: string;
  phone: string;
  source: string;
  variation: string;
  smsConsent: boolean;
  ua: string;
  ip: string;
}): Promise<number | null> {
  const connectionString =
    process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) return null;
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(connectionString);
    await sql`
      CREATE TABLE IF NOT EXISTS waitlist (
        id          SERIAL PRIMARY KEY,
        email       TEXT NOT NULL UNIQUE,
        phone       TEXT NOT NULL,
        source      TEXT,
        variation   TEXT,
        sms_consent BOOLEAN NOT NULL DEFAULT FALSE,
        sms_consent_at TIMESTAMPTZ,
        user_agent  TEXT,
        ip          TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    await sql`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS variation TEXT;`;
    await sql`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS sms_consent BOOLEAN NOT NULL DEFAULT FALSE;`;
    await sql`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS sms_consent_at TIMESTAMPTZ;`;
    const rows = (await sql`
      INSERT INTO waitlist (email, phone, source, variation, sms_consent, sms_consent_at, user_agent, ip)
      VALUES (${entry.email}, ${entry.phone}, ${entry.source}, ${entry.variation}, ${entry.smsConsent}, ${entry.smsConsent ? new Date().toISOString() : null}, ${entry.ua}, ${entry.ip})
      ON CONFLICT (email) DO UPDATE SET
        phone = EXCLUDED.phone,
        variation = EXCLUDED.variation,
        sms_consent = EXCLUDED.sms_consent OR waitlist.sms_consent,
        sms_consent_at = COALESCE(waitlist.sms_consent_at, EXCLUDED.sms_consent_at)
      RETURNING id;
    `) as { id: number }[];
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error("[waitlist] postgres failed", err);
    return null;
  }
}

/**
 * Sends the LLM-generated welcome SMS and seeds the conversation, but only the
 * first time we see this phone (so re-signups don't re-trigger the interview).
 */
async function startSmsConversation(phone: string, email: string): Promise<void> {
  if (!twilioConfigured()) return;
  const sql = getSql();
  if (!sql) return;
  try {
    await ensureSmsSchema(sql);

    const existing = (await sql`
      SELECT 1 FROM sms_messages WHERE phone = ${phone} LIMIT 1;
    `) as unknown[];
    if (existing.length > 0) return; // already in a conversation

    await sql`
      INSERT INTO leads (email, phone)
      VALUES (${email}, ${phone})
      ON CONFLICT (email) DO UPDATE SET phone = COALESCE(EXCLUDED.phone, leads.phone), updated_at = NOW();
    `;

    const opener = await generateOpener(email);
    const sent = await sendSms(phone, opener);
    if (sent) {
      await sql`
        INSERT INTO sms_messages (phone, direction, body)
        VALUES (${phone}, 'outbound', ${opener});
      `;
    }
  } catch (err) {
    console.error("[waitlist] startSmsConversation failed", err);
  }
}

export async function POST(req: Request) {
  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = normalizeEmail(body.email ?? "");
  const phone = normalizePhone(body.phone ?? "");
  const source = (body.source ?? "/").slice(0, 200);
  const variation = (body.variation ?? "0").toString().slice(0, 32);
  const smsConsent = body.smsConsent === true;

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  // Phone is optional now (email-only signup to reduce friction).

  const ua = req.headers.get("user-agent")?.slice(0, 300) ?? "";
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "";

  const entry = { email, phone, source, variation, smsConsent, ua, ip };

  const [id] = await Promise.all([
    persistToPostgres(entry),
    notifyWebhook(entry),
  ]);

  console.log("[waitlist] signup", {
    email,
    phone,
    variation,
    source,
    smsConsent,
    id,
    persisted: id !== null,
  });

  // Stamp the variation on the lead too, so per-variation conversion stats
  // can join `waitlist` and `leads` without ambiguity. We never overwrite a
  // previously-set variation — the FIRST landing-page variation that brought
  // them in is the one that "owns" the conversion.
  if (id !== null) {
    const sql = getSql();
    if (sql) {
      try {
        await ensureSmsSchema(sql);
        await sql`
          INSERT INTO leads (email, variation)
          VALUES (${email}, ${variation || null})
          ON CONFLICT (email) DO UPDATE SET
            variation = COALESCE(leads.variation, EXCLUDED.variation),
            updated_at = NOW();
        `;
      } catch (err) {
        console.error("[waitlist] lead variation stamp failed", err);
      }
    }
  }

  // Only text people who explicitly opted in (consent is optional, never required).
  if (smsConsent) {
    await startSmsConversation(phone, email);
  }

  return NextResponse.json({
    ok: true,
    position: id ?? undefined,
  });
}
