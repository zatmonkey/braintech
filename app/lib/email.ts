// Minimal transactional email. Uses Resend if RESEND_API_KEY is set; otherwise
// returns { delivered:false, devCode } so OTP login is testable without a
// provider (the code is surfaced to the caller in dev).
export async function sendOtpEmail(
  to: string,
  code: string,
): Promise<{ delivered: boolean }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Braintech <onboarding@resend.dev>";
  if (!key) {
    console.log(`[email] DEV MODE — OTP for ${to} is ${code} (set RESEND_API_KEY to send real email)`);
    return { delivered: false };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: `Your Braintech code: ${code}`,
        text: `Your Braintech sign-in code is ${code}. It expires in 10 minutes.`,
        html: `<div style="font-family:system-ui,sans-serif;font-size:16px;color:#1a1714">
          <p>Your Braintech sign-in code is:</p>
          <p style="font-size:32px;font-weight:700;letter-spacing:4px">${code}</p>
          <p style="color:#4a443d">It expires in 10 minutes. If you didn't request this, ignore it.</p>
        </div>`,
      }),
    });
    if (!res.ok) {
      console.error("[email] resend failed", res.status, await res.text().catch(() => ""));
      return { delivered: false };
    }
    return { delivered: true };
  } catch (err) {
    console.error("[email] send error", err);
    return { delivered: false };
  }
}

/**
 * Confirmation email after someone claims the 10% off on the landing page.
 *
 * The "code" is a Stripe coupon ID applied via a cookie that /api/checkout
 * reads — there isn't a user-facing code to type. The email's job is just
 * to (a) prove the signup was real, (b) give a one-click buy button that
 * lands the user back on getbraintech.com where the cookie auto-applies,
 * and (c) tell them what to do if they're on a different device when they
 * decide to buy.
 *
 * Site URL is read from NEXT_PUBLIC_SITE_URL; falls back to the prod URL.
 */
export async function sendDiscountEmail(
  to: string,
  opts: { percentOff: number; couponId: string },
): Promise<{ delivered: boolean }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Braintech <onboarding@resend.dev>";
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://getbraintech.com";
  // /buy reads `email` to prefill the input and `dc` to activate the
  // discount card + pass the coupon to /api/checkout (no cookie needed,
  // works cross-device).
  const buyUrl = `${site}/buy?email=${encodeURIComponent(to)}&dc=${encodeURIComponent(opts.couponId)}`;
  const pct = opts.percentOff;
  if (!key) {
    console.log(`[email] DEV MODE — discount confirmation for ${to} (${pct}% off, set RESEND_API_KEY to send real email)`);
    return { delivered: false };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: `Your ${pct}% off Braintech is locked in`,
        text:
`Thanks for the email — your ${pct}% off is locked in for ${to}.

Ready to order? Just open getbraintech.com on the device you used to claim it and the discount applies automatically at checkout:

${buyUrl}

If you're on a different device when you decide to buy, just re-enter ${to} on the landing page and the same ${pct}% off comes back.

Questions? Reply to this email — it goes straight to a human.

— The Braintech team`,
        html: `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.55;color:#1a1714;max-width:520px;margin:0 auto;padding:24px">
          <p style="margin:0 0 16px"><span style="display:inline-block;background:#fff1e6;color:#d9550f;font-weight:600;padding:4px 10px;border-radius:999px;font-size:13px">${pct}% off · locked in</span></p>
          <p style="margin:0 0 12px;font-size:20px;font-weight:600">Your ${pct}% off Braintech is reserved.</p>
          <p style="margin:0 0 20px;color:#4a443d">Thanks for the email — we've held a ${pct}% discount against <strong>${to}</strong>. It applies automatically at checkout.</p>
          <p style="margin:0 0 24px">
            <a href="${buyUrl}" style="display:inline-block;background:#d9550f;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">Order now with ${pct}% off →</a>
          </p>
          <p style="margin:0 0 12px;color:#4a443d;font-size:14px">If you're on a different device when you decide to buy, just re-enter <strong>${to}</strong> on <a href="${site}" style="color:#d9550f">getbraintech.com</a> — the same ${pct}% off comes back.</p>
          <hr style="border:0;border-top:1px solid #ece8e0;margin:24px 0">
          <p style="margin:0;color:#7a7368;font-size:13px">Questions? Reply to this email — it goes straight to a human.</p>
        </div>`,
      }),
    });
    if (!res.ok) {
      console.error("[email] resend (discount) failed", res.status, await res.text().catch(() => ""));
      return { delivered: false };
    }
    return { delivered: true };
  } catch (err) {
    console.error("[email] discount send error", err);
    return { delivered: false };
  }
}
