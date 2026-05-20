import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let cached: NeonQueryFunction<false, false> | null = null;

export function getSql(): NeonQueryFunction<false, false> | null {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) return null;
  if (!cached) cached = neon(connectionString);
  return cached;
}

let schemaReady = false;

/**
 * Idempotently creates:
 *  - leads:        one row per person, keyed by email. phone is optional.
 *                  `memory` is a compact blob the LLM maintains during the
 *                  discovery interview.
 *  - sms_messages: the full inbound/outbound conversation log (keyed by phone,
 *                  the identifier Twilio gives us on inbound).
 */
export async function ensureSmsSchema(
  sql: NeonQueryFunction<false, false>,
): Promise<void> {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS leads (
      email               TEXT PRIMARY KEY,
      phone               TEXT,
      memory              TEXT,
      interview_complete  BOOLEAN NOT NULL DEFAULT FALSE,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS leads_phone_idx ON leads (phone);`;
  await sql`
    CREATE TABLE IF NOT EXISTS sms_messages (
      id          SERIAL PRIMARY KEY,
      phone       TEXT NOT NULL,
      direction   TEXT NOT NULL,
      body        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS sms_messages_phone_idx ON sms_messages (phone, created_at);`;
  schemaReady = true;
}
