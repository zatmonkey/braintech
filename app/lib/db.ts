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
      owner_email      TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS owner_email TEXT;`;
  await sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS telemetry JSONB;`;
  await sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS telemetry_at TIMESTAMPTZ;`;
  deviceSchemaReady = true;
}

let authSchemaReady = false;

/** One-time passcodes for parent email login. */
export async function ensureAuthSchema(
  sql: NeonQueryFunction<false, false>,
): Promise<void> {
  if (authSchemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS otps (
      email       TEXT PRIMARY KEY,
      code_hash   TEXT NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      attempts    INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  authSchemaReady = true;
}

let accountSchemaReady = false;

/** Per-account tables for renamed clients and applied rules. */
export async function ensureAccountSchema(
  sql: NeonQueryFunction<false, false>,
): Promise<void> {
  if (accountSchemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS client_labels (
      owner_email TEXT NOT NULL,
      mac         TEXT NOT NULL,
      name        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (owner_email, mac)
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS account_rules (
      rule_id     TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      device_id   TEXT NOT NULL,
      name        TEXT NOT NULL,
      rule_type   TEXT NOT NULL,
      summary     TEXT,
      params      JSONB,
      ops         JSONB,
      active      BOOLEAN NOT NULL DEFAULT TRUE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS account_rules_owner_idx ON account_rules(owner_email, active);`;
  await sql`ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS pending_proposal JSONB;`;

  // Household memory: who lives here, what devices they own, free-form notes.
  // This is the canonical long-term state Bri reads from EVERY turn. The
  // chat transcript is just conversational flow — never a state store.
  await sql`
    CREATE TABLE IF NOT EXISTS account_memory (
      owner_email  TEXT PRIMARY KEY,
      humans       JSONB NOT NULL DEFAULT '[]'::jsonb,
      notes        TEXT NOT NULL DEFAULT '',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  // Device groups: a named bucket of MACs that rules can target as a unit
  // (e.g. "kids", "iot", "theo-devices"). NOT a VLAN — this is purely a
  // logical scope; the router still sees one flat LAN. A MAC belongs to at
  // most one group (membership lives on client_labels.group_id).
  await sql`
    CREATE TABLE IF NOT EXISTS account_groups (
      group_id     TEXT PRIMARY KEY,
      owner_email  TEXT NOT NULL,
      name         TEXT NOT NULL,
      description  TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS account_groups_owner_idx ON account_groups(owner_email);`;
  await sql`ALTER TABLE client_labels ADD COLUMN IF NOT EXISTS group_id TEXT;`;
  accountSchemaReady = true;
}
