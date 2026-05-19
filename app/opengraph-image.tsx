import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Braintech — Your kid wants TikTok. Make them earn it.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: "#f5f1ea",
          color: "#1a1714",
          fontFamily: "Georgia, serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: "#1a1714",
              color: "#f5f1ea",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              fontWeight: 700,
              fontFamily: "Helvetica, Arial, sans-serif",
            }}
          >
            b
          </div>
          <span style={{ fontFamily: "Helvetica, Arial, sans-serif" }}>
            braintech
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "8px 16px",
              border: "1px solid #d9d0bf",
              borderRadius: 999,
              fontSize: 20,
              fontWeight: 500,
              color: "#4a443d",
              alignSelf: "flex-start",
              background: "rgba(255,255,255,0.6)",
              fontFamily: "Helvetica, Arial, sans-serif",
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: "#d94f1a",
              }}
            />
            First batch — 1,000 devices
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 96,
              lineHeight: 1.02,
              letterSpacing: "-0.025em",
              fontFamily: "Georgia, serif",
            }}
          >
            <span>Your kid wants TikTok.</span>
            <span style={{ color: "#d94f1a", fontStyle: "italic" }}>
              Make them earn it.
            </span>
          </div>

          <div
            style={{
              fontSize: 28,
              lineHeight: 1.35,
              color: "#4a443d",
              maxWidth: 920,
              fontFamily: "Helvetica, Arial, sans-serif",
            }}
          >
            Text-message parental control that turns screen time into earned
            learning time.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontFamily: "Helvetica, Arial, sans-serif",
            fontSize: 22,
            color: "#4a443d",
          }}
        >
          <span>braintech.app</span>
          <span style={{ fontWeight: 600, color: "#1a1714" }}>
            Founding members $249/yr
          </span>
        </div>
      </div>
    ),
    size,
  );
}
