import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Self-contained server build for the Docker image (.next/standalone).
  output: "standalone",
  // These spawn child processes / carry binaries — keep them external so Next
  // doesn't try to bundle them into the server build.
  serverExternalPackages: ["youtube-dl-exec", "ffmpeg-static", "archiver"],
}

export default nextConfig
