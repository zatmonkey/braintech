import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: "-0.04em",
          fontFamily: "Helvetica, Arial, sans-serif",
          borderRadius: 6,
        }}
      >
        b
      </div>
    ),
    size,
  );
}
