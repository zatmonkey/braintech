/**
 * Append-only audit trail for rule lifecycle events. Born from a real
 * mystery: both of Maya's rules were deactivated 18 seconds after a
 * credit grant on 2026-08-11 and nothing recorded who or what did it.
 * Every create/deactivate now lands here with actor + source.
 */
import type { NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

let ensured = false;

export async function ensureRuleAuditSchema(sql: Sql): Promise<void> {
  if (ensured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS rule_audit_log (
      id          BIGSERIAL PRIMARY KEY,
      owner_email TEXT NOT NULL,
      rule_id     TEXT NOT NULL,
      action      TEXT NOT NULL, -- 'create' | 'deactivate'
      source      TEXT NOT NULL, -- 'dashboard' | 'bri' | 'system'
      actor       TEXT,          -- session email that triggered it
      detail      TEXT,          -- rule name or free-form context
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS rule_audit_log_owner_time
    ON rule_audit_log (owner_email, created_at DESC);
  `;
  ensured = true;
}

export async function logRuleAudit(
  sql: Sql,
  entry: {
    owner_email: string;
    rule_id: string;
    action: "create" | "deactivate" | "pause" | "resume";
    source: "dashboard" | "bri" | "system";
    actor?: string;
    detail?: string;
  },
): Promise<void> {
  try {
    await ensureRuleAuditSchema(sql);
    await sql`
      INSERT INTO rule_audit_log (owner_email, rule_id, action, source, actor, detail)
      VALUES (${entry.owner_email}, ${entry.rule_id}, ${entry.action},
              ${entry.source}, ${entry.actor ?? null}, ${entry.detail ?? null});
    `;
  } catch (err) {
    // Auditing must never break the operation it describes.
    console.error("[rule-audit] insert failed", err);
  }
}
