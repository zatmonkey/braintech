import { ImageResponse } from "next/og";

export const runtime = "nodejs";

// A faithful rendering of the live waitlist opt-in (getbraintech.com) for
// toll-free / A2P verification: phone collection + explicit consent checkbox
// with the full SMS disclosure.
export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#f5f1ea",
          color: "#1a1714",
          padding: "56px",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 26, fontWeight: 700 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: "#0b0b0d" }} />
          braintech · getbraintech.com
        </div>

        <div
          style={{
            marginTop: 36,
            display: "flex",
            flexDirection: "column",
            background: "#ffffff",
            border: "1px solid #d9d0bf",
            borderRadius: 20,
            padding: 40,
          }}
        >
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Get 10% off your Braintech device
          </div>

          <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 18, color: "#4a443d", fontWeight: 600 }}>EMAIL</div>
            <div style={{ fontSize: 24, color: "#9a9389", border: "1px solid #d9d0bf", borderRadius: 10, padding: "16px 20px", background: "#f5f1ea" }}>
              you@example.com
            </div>
          </div>

          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 18, color: "#4a443d", fontWeight: 600 }}>MOBILE NUMBER</div>
            <div style={{ fontSize: 24, color: "#9a9389", border: "1px solid #d9d0bf", borderRadius: 10, padding: "16px 20px", background: "#f5f1ea" }}>
              +1 (555) 123-4567
            </div>
          </div>

          <div style={{ marginTop: 24, display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div style={{ width: 26, height: 26, borderRadius: 6, background: "#d94f1a", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 19, lineHeight: 1.5, color: "#4a443d" }}>
              <div style={{ fontWeight: 700, color: "#1a1714" }}>Yes, text me (optional).</div>
              <div>
                I agree to receive recurring automated text messages from
                Braintech (Mutant Ventures LLC) at the mobile number I provide —
                a welcome message and a few setup questions. Consent is not a
                condition of purchase or joining the waitlist. Message frequency
                varies; message and data rates may apply. Reply STOP to
                unsubscribe, HELP for help. See our SMS Terms &amp; Privacy
                Policy.
              </div>
            </div>
          </div>

          <div style={{ marginTop: 28, display: "flex", background: "#1a1714", color: "#f5f1ea", borderRadius: 10, padding: "18px 28px", fontSize: 24, fontWeight: 600, justifyContent: "center" }}>
            Get 10% off →
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 1000 },
  );
}
