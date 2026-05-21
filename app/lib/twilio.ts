import twilio from "twilio";

export function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_MESSAGING_SERVICE_SID ||
        process.env.TWILIO_PHONE_NUMBER),
  );
}

export async function sendSms(to: string, body: string): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid || !token || (!from && !messagingServiceSid)) {
    console.error("[twilio] not configured; cannot send");
    return false;
  }
  try {
    const client = twilio(sid, token);
    // Prefer the Messaging Service (associates the send with the registered
    // A2P campaign) once one is configured; fall back to the bare number.
    await client.messages.create(
      messagingServiceSid
        ? { to, body, messagingServiceSid }
        : { to, body, from: from! },
    );
    return true;
  } catch (err) {
    console.error("[twilio] send failed", err);
    return false;
  }
}

/**
 * Verifies the X-Twilio-Signature header so randoms can't POST to the webhook.
 * url must be the exact public URL Twilio was configured to call.
 */
export function verifyTwilioSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>,
): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  return twilio.validateRequest(token, signature, url, params);
}

export function twiml(message: string): string {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}
