# syntax=docker/dockerfile:1
#
# Multi-stage build for the reddit-downloader Next.js app.
# Stateless container (DB is managed Neon). Targets a container host such as
# Railway or Fly — NOT Vercel serverless (long jobs + native binaries).

ARG NODE_VERSION=22

#############################
# 1. Dependencies
#############################
FROM node:${NODE_VERSION}-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app

# Skip youtube-dl-exec's bundled yt-dlp download — production uses the system
# yt-dlp binary installed in the runner (see below).
ENV YOUTUBE_DL_SKIP_DOWNLOAD=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

#############################
# 2. Build
#############################
FROM node:${NODE_VERSION}-bookworm-slim AS builder
RUN corepack enable
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

#############################
# 3. Runtime
#############################
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    YT_DLP_PATH=/usr/local/bin/yt-dlp

# ffmpeg for merging v.redd.it video+audio; yt-dlp standalone linux binary
# (self-contained, needs no Python) for the actual video download.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && curl -fL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
      -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && apt-get purge -y curl \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

# Run as non-root.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Next.js standalone output: a minimal server with traced node_modules.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# server.js is emitted by Next's standalone output.
CMD ["node", "server.js"]
