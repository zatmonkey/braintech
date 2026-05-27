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
      email                   TEXT PRIMARY KEY,
      phone                   TEXT,
      memory                  TEXT,
      interview_complete      BOOLEAN NOT NULL DEFAULT FALSE,
      deposit_paid            BOOLEAN NOT NULL DEFAULT FALSE,
      deposit_amount          INTEGER,
      deposit_at              TIMESTAMPTZ,
      stripe_session_id       TEXT,
      stripe_payment_intent   TEXT,
      shipping_country        TEXT,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS leads_phone_idx ON leads (phone);`;
  // Add deposit columns to pre-existing leads tables.
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS deposit_paid BOOLEAN NOT NULL DEFAULT FALSE;`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS deposit_amount INTEGER;`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS deposit_at TIMESTAMPTZ;`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT;`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS shipping_country TEXT;`;
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

let chatSchemaReady = false;

/**
 * Browser demo-chat tables:
 *  - chat_sessions: one row per browser session (memory blob + captured email)
 *  - chat_messages: full transcript
 */
export async function ensureChatSchema(
  sql: NeonQueryFunction<false, false>,
): Promise<void> {
  if (chatSchemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      session_id  TEXT PRIMARY KEY,
      email       TEXT,
      memory      TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id          SERIAL PRIMARY KEY,
      session_id  TEXT NOT NULL,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages (session_id, created_at);`;
  chatSchemaReady = true;
}

let deviceSchemaReady = false;

/**
 * Device registry / desired-state store for the OpenWrt agent fleet.
 * `desired` holds the ops array; `desired_version` is bumped each change.
 * `psk` is the per-device pre-shared key (bearer auth + HMAC signing).
 */
export async function ensureDeviceSchema(
  sql: NeonQueryFunction<false, false>,
): Promise<void> {
  if (deviceSchemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS devices (
      device_id        TEXT PRIMARY KEY,
      psk              TEXT NOT NULL,
      label            TEXT,
      mac              TEXT,
      desired          JSONB,
      desired_version  INTEGER NOT NULL DEFAULT 0,
      reported_version INTEGER NOT NULL DEFAULT 0,
      last_status      TEXT,
      last_seen        TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  deviceSchemaReady = true;
}
