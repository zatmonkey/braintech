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
