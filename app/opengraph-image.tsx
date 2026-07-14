import { ImageResponse } from "next/og"

export const alt = "Reddit Downloader"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 24,
          background: "#0a0a0a",
          color: "#fafafa",
          padding: 80,
        }}
      >
        <div style={{ fontSize: 68, fontWeight: 600, letterSpacing: -2 }}>
          Reddit Downloader
        </div>
        <div style={{ fontSize: 32, color: "#a1a1aa", lineHeight: 1.4 }}>
          Paste one or more Reddit URLs and download images, galleries, and
          videos with audio.
        </div>
      </div>
    ),
    size,
  )
}
