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
    const responseBody = await res.text().catch(() => "");
    if (!res.ok) {
      console.error("[email] resend (discount) failed", res.status, responseBody);
      return { delivered: false };
    }
    // Log success too — Resend's `onboarding@resend.dev` sandbox sender
    // accepts the request and returns 200 + an id even for recipients
    // it won't actually deliver to. Surfacing the id + 'to' makes the
    // "Resend says ok but nothing arrives" case debuggable from logs.
    console.log("[email] resend (discount) sent", { to, body: responseBody.slice(0, 200) });
    return { delivered: true };
  } catch (err) {
    console.error("[email] discount send error", err);
    return { delivered: false };
  }
}

/**
 * "Hey, $person is on $app — OK or limit?" nudge from Bri. Fired by
 * the /api/cron/app-alerts cron when an undecided app crosses the
 * threshold. The OK/Limit links are signed so anyone with the email
 * can decide without logging in.
 */
export async function sendAppDecisionEmail(
  to: string,
  opts: {
    person_name: string;
    app: string;
    minutes_today: number;
    minutes_7d: number;
    rollup: "brainrot" | "learning" | "other";
    ok_url: string;
    limit_url: string;
    dashboard_url: string;
  },
): Promise<{ delivered: boolean }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Braintech <onboarding@resend.dev>";
  if (!key) {
    console.log(
      `[email] DEV — app decision nudge for ${to}: ${opts.person_name} / ${opts.app} (${opts.minutes_today}m today)`,
    );
    return { delivered: false };
  }
  const flavor =
    opts.rollup === "brainrot"
      ? "looks like classic brainrot territory"
      : opts.rollup === "learning"
        ? "this one's on our learning list"
        : "we don't have an opinion on this one yet";
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
        subject: `${opts.person_name} is spending time on ${opts.app}`,
        text:
`Hey — ${opts.person_name} is on ${opts.app}: ${opts.minutes_today} min today, ${opts.minutes_7d} min over the last 7 days. ${flavor}.

Are you OK with it, or want to limit it?

OK with it:    ${opts.ok_url}
Limit it:      ${opts.limit_url}

Either click sets the rule and silences this nudge. You can also handle it on the dashboard:
${opts.dashboard_url}

— Bri`,
        html: `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.55;color:#1a1714;max-width:540px;margin:0 auto;padding:24px">
          <p style="margin:0 0 8px;font-size:20px;font-weight:600">${opts.person_name} is on <strong>${opts.app}</strong>.</p>
          <p style="margin:0 0 16px;color:#4a443d"><strong>${opts.minutes_today} min today</strong> · ${opts.minutes_7d} min over the last 7 days · <em>${flavor}</em>.</p>
          <p style="margin:0 0 20px;color:#4a443d">Are you OK with it, or want to limit it?</p>
          <p style="margin:0 0 12px">
            <a href="${opts.ok_url}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;margin-right:8px">✓ OK with it</a>
            <a href="${opts.limit_url}" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">🚫 Limit it</a>
          </p>
          <p style="margin:24px 0 0;color:#7a7368;font-size:13px">Either click sets the call and silences this nudge. <a href="${opts.dashboard_url}" style="color:#d9550f">Open the dashboard</a> for the full picture.</p>
          <p style="margin:8px 0 0;color:#7a7368;font-size:13px">— Bri</p>
        </div>`,
      }),
    });
    if (!res.ok) {
      console.error("[email] resend (app decision) failed", res.status, await res.text().catch(() => ""));
      return { delivered: false };
    }
    return { delivered: true };
  } catch (err) {
    console.error("[email] app decision send error", err);
    return { delivered: false };
  }
}

/**
 * "X invited you to co-admin their Braintech household." Lands on the
 * normal /login page; the invited admin signs in with the email this
 * was sent to and is automatically resolved to the household session
 * by /api/auth/verify.
 */
export async function sendAdminInviteEmail(
  to: string,
  opts: { invited_by: string; household: string },
): Promise<{ delivered: boolean }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Braintech <onboarding@resend.dev>";
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://getbraintech.com";
  const loginUrl = `${site}/login?from=/app`;
  if (!key) {
    console.log(`[email] DEV — admin invite for ${to} (by ${opts.invited_by})`);
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
        subject: `${opts.invited_by} invited you to co-admin a Braintech household`,
        text:
`${opts.invited_by} added you as a co-admin on their Braintech household (${opts.household}).

Sign in here to accept — same email, magic-code flow:

${loginUrl}

You'll have the same powers they do: manage rules, see device usage, run the kid earn flow. If this is a surprise, just ignore — nothing happens until you sign in.

— Braintech`,
        html: `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.55;color:#1a1714;max-width:520px;margin:0 auto;padding:24px">
          <p style="margin:0 0 12px;font-size:20px;font-weight:600">${opts.invited_by} invited you to co-admin a Braintech household.</p>
          <p style="margin:0 0 16px;color:#4a443d">Same powers they have — manage rules, see device usage, run the kid earn flow. Sign in with this email to accept.</p>
          <p style="margin:0 0 24px">
            <a href="${loginUrl}" style="display:inline-block;background:#d9550f;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">Accept &amp; sign in →</a>
          </p>
          <p style="margin:0;color:#7a7368;font-size:13px">If this is a surprise, just ignore — nothing happens until you sign in.</p>
        </div>`,
      }),
    });
    const body = await res.text().catch(() => "");
    if (!res.ok) {
      console.error("[email] resend (admin invite) failed", res.status, body);
      return { delivered: false };
    }
    console.log("[email] resend (admin invite) sent", { to, body: body.slice(0, 200) });
    return { delivered: true };
  } catch (err) {
    console.error("[email] admin invite send error", err);
    return { delivered: false };
  }
}
