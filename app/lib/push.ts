/**
 * Web Push fan-out via web-push. Loads VAPID keys from env once.
 *
 *   sendPushToOwner(email, payload) — fires the payload to every
 *   subscription registered for that owner. Stale endpoints (HTTP 404
 *   / 410 from the push service) are deleted automatically so the next
 *   send doesn't keep trying.
 *
 * Payload shape is JSON the service-worker `push` listener parses.
 * Keep it small (<4KB) and harmless if the SW falls behind.
 */
import type { NeonQueryFunction } from "@neondatabase/serverless";
import webpush, { type PushSubscription } from "web-push";

let configured = false;
function configure() {
  if (configured) return;
  const publicKey =
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    process.env.VAPID_PUBLIC_KEY ||
    "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  const subject = process.env.VAPID_SUBJECT || "mailto:alex@ksso.net";
  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys not configured");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  // Custom data the SW or click-handler can use.
  data?: Record<string, unknown>;
};

export async function sendPushToOwner(
  sql: NeonQueryFunction<false, false>,
  email: string,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  configure();
  const rows = (await sql`
    SELECT endpoint, p256dh_key, auth_key
    FROM push_subscriptions
    WHERE owner_email = ${email};
  `) as { endpoint: string; p256dh_key: string; auth_key: string }[];
  if (rows.length === 0) return { sent: 0, pruned: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  let pruned = 0;
  for (const r of rows) {
    const sub: PushSubscription = {
      endpoint: r.endpoint,
      keys: { p256dh: r.p256dh_key, auth: r.auth_key },
    };
    try {
      await webpush.sendNotification(sub, body, { TTL: 60 * 60 * 24 });
      sent++;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      // 404 = endpoint gone. 410 = user unsubscribed. Either way: prune.
      if (e.statusCode === 404 || e.statusCode === 410) {
        await sql`DELETE FROM push_subscriptions WHERE endpoint = ${r.endpoint};`;
        pruned++;
      } else {
        console.error("[push] send failed", r.endpoint, e.statusCode, e.message);
      }
    }
  }
  return { sent, pruned };
}
