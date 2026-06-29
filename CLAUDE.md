# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm** (Node 22+).

- `pnpm dev` — dev server (http://localhost:3000). Env vars are **not** hot-reloaded; restart after editing `.env.local`.
- `pnpm build` / `pnpm start` — prod build (`output: "standalone"`) / serve
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm lint` — eslint (`eslint-config-next`); `pnpm format` — prettier
- `pnpm db:generate` / `db:migrate` / `db:push` / `db:studio` — Drizzle (Neon Postgres)

There is no test suite. Verify changes with `pnpm typecheck` + `pnpm lint`.

## Next.js 16 caveat

This is **Next.js 16** (App Router), which has breaking changes vs. older Next. Do not assume APIs/conventions from training data — when unsure, read the relevant guide in `node_modules/next/dist/docs/` before writing code. There is no separate backend; the API is Route Handlers under `app/api/`.

## Architecture

Single Next.js app. The extraction → queue → download flow is the core:

**Extraction pipeline** (`lib/reddit/`): `processRedditUrl()` chains `resolveRedditUrl` (follows short/share-link redirects, re-validating the host is Reddit at every hop — anti-SSRF) → `fetchPostJson` (Reddit API) → `classifyPost` → a serializable `ResolvedPost` (`image` | `gallery` | `video` | `external`).

**Reddit auth** (`lib/reddit/auth.ts`): unauthenticated `.json` now 403s. With `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` set, the app uses app-only OAuth (client_credentials) against `oauth.reddit.com`, caching the bearer token in-process until ~60s before expiry. Without creds it falls back to the (likely-403) public path.

**Job queue** (`lib/queue.ts`): each batch of URLs becomes a `Job` with one `JobItem` per URL, processed through a shared `p-queue` (concurrency 3). State lives in **process memory** on `globalThis` (survives HMR), with finished jobs swept after 1h. Every state transition is `emit`ted on an `EventEmitter`; `snapshot()` deep-clones so SSE payloads decouple from later mutation. **This design assumes a single stateless container** — multiple replicas would require a shared store.

**Real-time state**: client `POST`s to `/api/extract` (creates job), then subscribes to `GET /api/jobs/[id]` (SSE). Snapshots are pushed into the TanStack Query cache via `hooks/use-job-stream.ts`. `lib/job-types.ts` holds the serializable types shared by server and client — keep it free of Node-only imports.

**Downloads are server-proxied, never direct CDN links.** Routes take `job`+`item` (+`i`) params, not client-supplied URLs; the server resolves the actual URL from its own job state and validates the host is a Reddit CDN (`isRedditMediaHost`) so the proxy can't be abused as an open SSRF proxy. Everything streams (never buffered):
- `/api/download/media` — image/gallery asset; counts bytes via a `TransformStream` and logs an anonymous event on `flush` (completed downloads only).
- `/api/download/video` — `lib/ytdlp.ts` (yt-dlp + ffmpeg merge of v.redd.it video+audio) to a temp dir, streamed out; the temp dir is **always** cleaned up via the read stream's `close` event (normal end, error, or client abort). Success logged on `end` only.
- `/api/download/zip` — streaming ZIP (`archiver`) for galleries / "download all".

**yt-dlp/ffmpeg resolution** (`lib/ytdlp.ts`): in dev, ffmpeg comes from `ffmpeg-static` and yt-dlp from the bundled `youtube-dl-exec` binary (needs Python ≥3.10 — fails on macOS system Python 3.9; use `brew install yt-dlp`). In Docker, system binaries are used via `YT_DLP_PATH`/`FFMPEG_PATH` env vars (the standalone build doesn't copy node_modules binaries; the standalone yt-dlp needs no Python).

**Logging** (`lib/db/`): `logDownloadEvent` writes anonymous rows to Neon Postgres — subreddit, post_type, sizes, etc., but **no IP/session/identity**. No-op when `DATABASE_URL` is unset, so the app runs fine without a DB.

## UI

shadcn/ui over **Base UI** + Tailwind v4. Components in `components/` (`ui/` is shadcn primitives). TanStack Query is the standing choice for all client data fetching/caching/SSE subscription state. NSFW posts render a blurred preview (`nsfw-blur.tsx`) with a reveal button.

## Deploy

Container host (Railway/Fly), **not** Vercel serverless (long-running jobs + system binaries). `Dockerfile` installs ffmpeg via apt and downloads the standalone yt-dlp binary. Container is stateless; DB is managed Neon.
