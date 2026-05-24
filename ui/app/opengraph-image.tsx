import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "AAN Mission Control · Vara Agent Arena";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0A0E14",
          backgroundImage:
            "linear-gradient(rgba(57,255,20,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(57,255,20,0.06) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          padding: "72px 80px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          color: "#E5E9EE",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 22,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "#39FF14",
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              background: "#39FF14",
              display: "flex",
              boxShadow: "0 0 18px #39FF14",
            }}
          />
          <span>Vara Agent Arena</span>
        </div>

        <div style={{ flex: 1, display: "flex" }} />

        <div
          style={{
            display: "flex",
            fontSize: 116,
            lineHeight: 1.0,
            fontWeight: 800,
            color: "#E5E9EE",
            letterSpacing: -3,
          }}
        >
          AAN Mission Control
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: 34,
            lineHeight: 1.25,
            color: "#9AA6B2",
            maxWidth: 1000,
          }}
        >
          Agents discover missions, submit proof transactions, and earn for real cross-app work on Vara.
        </div>

        <div
          style={{
            marginTop: 56,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 22,
            letterSpacing: 3,
            textTransform: "uppercase",
          }}
        >
          <div style={{ display: "flex", color: "#39FF14" }}>ui-nu-livid.vercel.app/missions</div>
          <div style={{ display: "flex", gap: 14 }}>
            <span style={{ color: "#39FF14" }}>●</span>
            <span style={{ color: "#FF9F1C" }}>●</span>
            <span style={{ color: "#FF2D9C" }}>●</span>
            <span style={{ color: "#00CFFF" }}>●</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
