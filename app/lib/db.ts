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
  // Which landing-page variation this lead came in on. Set when the lead
  // first hits the waitlist or starts checkout; never overwritten.
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS variation TEXT;`;
  // Stripe checkout flavour: 'deposit' = refundable spot-lock,
  // 'purchase' = full annual membership (buy-now variation). NULL until
  // the visitor opens a checkout session.
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS checkout_mode TEXT;`;
  // Localized-pricing context: the ISO country code we attributed the
  // lead to at checkout time, and the currency Stripe billed in (lowercase
  // ISO 4217). These pin the lead to the price tier they saw — useful when
  // reconciling refunds and for regional conversion analysis.
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS billing_country TEXT;`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS currency TEXT;`;
  // Set when the visitor lands on /?reserve=cancelled — i.e. opened a
  // Stripe Checkout session but didn't complete payment. NULL when never
  // cancelled or when deposit_paid is true (a paid lead can't also be a
  // cancelled lead — the webhook clears it).
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS checkout_cancelled_at TIMESTAMPTZ;`;
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
  // pending_proposal lives on chat_sessions but is used by the account
  // chat. Owning the ALTER here (not in ensureAccountSchema) means the
  // account-schema bootstrap stays self-contained — running it first on
  // a fresh DB won't fail because chat_sessions doesn't exist yet.
  await sql`ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS pending_proposal JSONB;`;
  chatSchemaReady = true;
}

let variationSchemaReady = false;

/**
 * Per-variation view counter. One row per (variation, visitor_id) so we
 * de-dupe unique views without storing IPs or user-agents. visitor_id is
 * the bt_var cookie's sibling — a random ID set in sessionStorage by the
 * client-side tracker. ON CONFLICT DO NOTHING is the whole de-dupe.
 *
 * Conversion rates come from joining this table's COUNT with
 * waitlist.variation and leads.variation counts.
 */
export async function ensureVariationSchema(
  sql: NeonQueryFunction<false, false>,
): Promise<void> {
  if (variationSchemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS variation_views (
      variation   TEXT NOT NULL,
      visitor_id  TEXT NOT NULL,
      ua_hash     TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (variation, visitor_id)
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS variation_views_var_idx ON variation_views (variation);`;
  variationSchemaReady = true;
}

let contentSchemaReady = false;

/**
 * Organic-content calendar. One row per scheduled date — the daily cron
 * routine reads CURRENT_DATE, posts the asset to IG, then marks
 * posted_at + permalink. Two ways to provide the asset:
 *   - asset_url: already-hosted image (e.g. /ig/ig-asset-N.jpg). Used as-is.
 *   - prompt:    Higgsfield generation prompt. Cron generates at post time.
 * Caption is required for FEED posts; ignored for STORIES (IG drops captions
 * on stories).
 */
export async function ensureContentSchema(
  sql: NeonQueryFunction<false, false>,
): Promise<void> {
  if (contentSchemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS content_calendar (
      scheduled_for DATE PRIMARY KEY,
      theme         TEXT,
      prompt        TEXT,
      asset_url     TEXT,
      caption       TEXT,
      media_type    TEXT NOT NULL DEFAULT 'IMAGE',
      aspect_ratio  TEXT,
      posted_at     TIMESTAMPTZ,
      permalink     TEXT,
      ig_media_id   TEXT,
      error_message TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS content_calendar_unposted_idx
      ON content_calendar (scheduled_for)
      WHERE posted_at IS NULL;
  `;
  // Carousel slides — array of publicly-fetchable image URLs. When media_type
  // is CAROUSEL_ALBUM the cron routine builds N child containers + 1
  // carousel container. Used by Monday stat posts (5-8 slide carousels
  // perform much better than single-image stat cards per Buffer benchmarks).
  await sql`
    ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS children_urls JSONB;
  `;
  // Cross-post toggle: when TRUE the cron also publishes to the connected
  // FB Page after the IG post lands. Default FALSE for opt-in cross-posting.
  await sql`
    ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS cross_post_fb BOOLEAN NOT NULL DEFAULT FALSE;
  `;
  contentSchemaReady = true;
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
  // Per-MAC presence history. Telemetry pushes upsert one row per visible
  // client each tick. The dashboard merges this with client_labels (friendly
  // name) and client_group_memberships (groups) into one canonical
  // "all devices in the last 7 days" list — connected if last_seen < 2min,
  // otherwise "last seen <relative time>".
  await sql`
    CREATE TABLE IF NOT EXISTS client_last_seen (
      owner_email  TEXT NOT NULL,
      mac          TEXT NOT NULL,
      hostname     TEXT,
      ip           TEXT,
      first_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (owner_email, mac)
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS client_last_seen_owner_recent_idx
      ON client_last_seen (owner_email, last_seen DESC);
  `;
  // Per-minute usage rollups — what the agent ships every telemetry tick.
  // Granularity: one row per (mac, minute, category). Minutes counted via
  // dnsmasq query log → IP → MAC → category. Brainrot meter = COUNT(DISTINCT
  // bucket_start) where category IN ('social','video','games').
  await sql`
    CREATE TABLE IF NOT EXISTS client_usage_minute (
      owner_email   TEXT NOT NULL,
      mac           TEXT NOT NULL,
      bucket_start  TIMESTAMPTZ NOT NULL,
      category      TEXT NOT NULL,
      query_count   INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (owner_email, mac, bucket_start, category)
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS client_usage_minute_owner_recent_idx
      ON client_usage_minute (owner_email, bucket_start DESC);
  `;
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

  // Device groups: named buckets of MACs that rules can target as a unit
  // (e.g. "kids", "iot", "theo-devices"). NOT a VLAN — this is purely a
  // logical scope; the router still sees one flat LAN.
  //
  // Membership is many-to-many: one MAC can belong to several groups (e.g.
  // a kid's phone is in BOTH "kids" and "school-allowed"). The junction
  // table is client_group_memberships. The old client_labels.group_id
  // column is kept as a one-to-one cache for backward compatibility and
  // migrated into the junction at schema-init time.
  await sql`
    CREATE TABLE IF NOT EXISTS account_groups (
      group_id     TEXT PRIMARY KEY,
      owner_email  TEXT NOT NULL,
      name         TEXT NOT NULL,
      description  TEXT,
      is_default   BOOLEAN NOT NULL DEFAULT FALSE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS account_groups_owner_idx ON account_groups(owner_email);`;
  await sql`ALTER TABLE account_groups ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;`;
  await sql`ALTER TABLE client_labels ADD COLUMN IF NOT EXISTS group_id TEXT;`;

  await sql`
    CREATE TABLE IF NOT EXISTS client_group_memberships (
      owner_email TEXT NOT NULL,
      mac         TEXT NOT NULL,
      group_id    TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (owner_email, mac, group_id)
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS cgm_owner_group_idx ON client_group_memberships(owner_email, group_id);`;
  await sql`CREATE INDEX IF NOT EXISTS cgm_owner_mac_idx ON client_group_memberships(owner_email, mac);`;
  // One-time backfill from the legacy single-column membership.
  await sql`
    INSERT INTO client_group_memberships (owner_email, mac, group_id)
    SELECT owner_email, mac, group_id FROM client_labels
    WHERE group_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  `;

  // Brainrot gauge — per-group allowance for time spent on brainrot apps
  // (YouTube / IG / TikTok / etc.). v1: parents set allowance + Bri toggles
  // the block manually. v2: agent reports nft-counter deltas, server
  // computes minutes_used, the gauge auto-blocks at zero.
  await sql`
    CREATE TABLE IF NOT EXISTS brainrot_state (
      group_id              TEXT PRIMARY KEY,
      owner_email           TEXT NOT NULL,
      weekday_minutes       INTEGER NOT NULL DEFAULT 30,
      weekend_minutes       INTEGER NOT NULL DEFAULT 120,
      reset_hour            INTEGER NOT NULL DEFAULT 4,
      open_until            TIMESTAMPTZ,    -- when set in the future: gauge open
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS brainrot_state_owner_idx ON brainrot_state(owner_email);`;
  await sql`
    CREATE TABLE IF NOT EXISTS brainrot_usage_log (
      group_id              TEXT NOT NULL,
      day                   DATE NOT NULL,
      minutes_consumed      INTEGER NOT NULL DEFAULT 0,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, day)
    );
  `;
  accountSchemaReady = true;
}

/**
 * Idempotently ensures one is_default group exists for the account. Called
 * from /api/account/state and /api/account/groups (GET) so every parent
 * always has a pre-made "All devices" bucket to drop things in. Returns the
 * group_id.
 */
export async function ensureDefaultGroup(
  sql: NeonQueryFunction<false, false>,
  email: string,
): Promise<string> {
  const found = (await sql`
    SELECT group_id FROM account_groups
    WHERE owner_email = ${email} AND is_default = TRUE LIMIT 1;
  `) as { group_id: string }[];
  if (found[0]) return found[0].group_id;
  // newGroupId would create a circular import; inline the same shape.
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  const gid = `grp_${hex}`;
  await sql`
    INSERT INTO account_groups (group_id, owner_email, name, description, is_default)
    VALUES (${gid}, ${email}, 'All devices', 'Default group — every device on the network.', TRUE);
  `;
  return gid;
}
