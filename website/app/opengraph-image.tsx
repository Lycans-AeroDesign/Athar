import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "Athar — Knowledge that doesn't graduate. An open-source, self-hosted knowledge management system.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  // Satori (behind next/og) can't parse variable or woff2 fonts, so the card
  // uses next/og's built-in sans-serif rather than the site's Inter.
  const shot = await readFile(join(process.cwd(), "public/screenshots/light-hero.png"));
  const shotSrc = `data:image/png;base64,${shot.toString("base64")}`;
  const grid = "rgba(183,196,255,0.06)";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", position: "relative",
          background: "#0a0e17", color: "#e6e8f0",
          backgroundImage: `linear-gradient(${grid} 1px, transparent 1px), linear-gradient(90deg, ${grid} 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 0 0 72px", width: 560 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 600 }}>
            <svg width="40" height="40" viewBox="0 0 32 32">
              <rect x="1" y="1" width="30" height="30" rx="7" fill="none" stroke="#b7c4ff" strokeOpacity="0.35" strokeWidth="1.5" />
              <path d="M9 23 16 16 23 9" stroke="#b7c4ff" strokeWidth="1.6" strokeLinecap="round" strokeOpacity="0.55" />
              <circle cx="9" cy="23" r="2.4" fill="#b7c4ff" fillOpacity="0.35" />
              <circle cx="16" cy="16" r="2.6" fill="#b7c4ff" fillOpacity="0.65" />
              <circle cx="23" cy="9" r="3" fill="#b7c4ff" />
            </svg>
            Athar
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 40, fontSize: 64, lineHeight: 1.05, letterSpacing: -2, fontWeight: 600 }}>
            <span>Knowledge that</span>
            <span style={{ color: "#b7c4ff" }}>
              doesn&apos;t graduate.
            </span>
          </div>
          <div style={{ marginTop: 28, fontSize: 24, lineHeight: 1.4, color: "#a2aabe" }}>
            Open-source, self-hosted knowledge management for engineering teams.
          </div>
          <div style={{ marginTop: 32, fontSize: 18, color: "#6f7890", letterSpacing: 1 }}>
            github.com/Lycans-AeroDesign/Athar
          </div>
        </div>
        <div
          style={{
            position: "absolute", left: 660, top: 90, width: 760, height: 475, display: "flex",
            borderRadius: 12, overflow: "hidden", border: "1px solid rgba(183,196,255,0.25)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shotSrc} width={760} height={475} alt="" style={{ objectFit: "cover", objectPosition: "left top" }} />
        </div>
      </div>
    ),
    size,
  );
}
