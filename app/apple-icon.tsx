import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#1a1714",
          color: "#f5f1ea",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 130,
          fontWeight: 700,
          letterSpacing: "-0.04em",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        b
      </div>
    ),
    size,
  );
}
