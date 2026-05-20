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
 * Idempotently creates the two SMS tables:
 *  - sms_users:    one row per phone number, holding the facts we learn
 *  - sms_messages: the full inbound/outbound conversation log
 */
export async function ensureSmsSchema(
  sql: NeonQueryFunction<false, false>,
): Promise<void> {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS sms_users (
      phone               TEXT PRIMARY KEY,
      email               TEXT,
      parent_name         TEXT,
      num_kids            INTEGER,
      kids_ages           TEXT,
      goal                TEXT,
      notes               TEXT,
      interview_complete  BOOLEAN NOT NULL DEFAULT FALSE,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
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
