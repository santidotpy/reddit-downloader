/**
 * gallery-dl adapter — the ONLY module that knows gallery-dl exists.
 *
 * The rest of the app speaks `ResolvedPost` (see `lib/reddit/types.ts`); if we
 * ever swap gallery-dl for something else, only this file changes.
 *
 * `extractPost` runs `gallery-dl -j <url>` (metadata only, no bytes downloaded)
 * and normalizes the output into a `ResolvedPost`. gallery-dl resolves
 * short/share links itself, so we hand it the raw URL directly.
 *
 * NOTE: gallery-dl's `-j` output shape (message-type ints + the Reddit
 * extractor's metadata keys) is parsed defensively below. The exact keys can
 * vary across gallery-dl versions, so unknown/missing fields degrade to
 * undefined rather than throwing. Verify against real output when bumping
 * gallery-dl (see `gallery-dl -j <reddit-url>`).
 */
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { RedditFetchError } from "@/lib/reddit/errors";
import type { MediaAsset, ResolvedPost } from "@/lib/reddit/types";

const execFileAsync = promisify(execFile);

/** Binary on PATH in dev; in Docker we point this at the standalone binary. */
const GALLERY_DL = process.env.GALLERY_DL_PATH || "gallery-dl";
const EXTRACT_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 4 * 60 * 1000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export interface DownloadedFile {
  path: string;
  sizeBytes: number;
}

export interface DownloadedMedia {
  dir: string;
  /** In post order (gallery index). */
  files: DownloadedFile[];
  cleanup: () => Promise<void>;
}

/**
 * Reddit fronts its API with a bot-detection WAF that blocks datacenter IPs and
 * unrecognized clients ("blocked by network security"). gallery-dl needs to be
 * told who it is to get through; we pass everything explicitly so the app's
 * process doesn't depend on a global gallery-dl config it may not even read.
 *
 * Levers, in increasing order of effectiveness against the WAF:
 *   REDDIT_USER_AGENT     - a descriptive/browser-like UA (Reddit blocks generic ones)
 *   REDDIT_CLIENT_ID +    - app-only / authenticated OAuth -> requests hit
 *   REDDIT_REFRESH_TOKEN    oauth.reddit.com instead of the walled web path
 *   GALLERY_DL_COOKIES    - path to a browser cookies.txt (strongest bypass)
 *   GALLERY_DL_CONFIG     - explicit config file (overrides default discovery)
 */
function authArgs(): string[] {
  const args: string[] = [];
  if (process.env.GALLERY_DL_CONFIG) {
    args.push("--config", process.env.GALLERY_DL_CONFIG);
  }
  // Deliberately DO NOT override the user-agent: gallery-dl's default reddit UA
  // is browser-like and passes Reddit's WAF, whereas the legacy REDDIT_USER_AGENT
  // (Reddit API "app:id:ver" format, for the old pipeline) is bot-shaped and gets
  // blocked. Override only via an explicit GALLERY_DL_CONFIG if ever needed.
  // OAuth only: a client-id WITHOUT a matching refresh-token makes gallery-dl
  // attempt (and fail) OAuth -> AuthenticationError, clobbering cookie auth. So
  // only send the reddit OAuth pair when both are present; otherwise let
  // gallery-dl use its built-in client-id + whatever cookies we passed. The
  // legacy REDDIT_CLIENT_ID (for the old custom pipeline) is intentionally NOT
  // forwarded on its own.
  if (process.env.REDDIT_REFRESH_TOKEN) {
    args.push("-o", `extractor.reddit.refresh-token=${process.env.REDDIT_REFRESH_TOKEN}`);
    if (process.env.REDDIT_CLIENT_ID) {
      args.push("-o", `extractor.reddit.client-id=${process.env.REDDIT_CLIENT_ID}`);
    }
  }
  if (process.env.GALLERY_DL_COOKIES) {
    args.push("--cookies", process.env.GALLERY_DL_COOKIES);
  }
  // e.g. "firefox", "chrome", "safari" — uses your logged-in Reddit session,
  // the most reliable way past the WAF for local/personal use.
  if (process.env.GALLERY_DL_COOKIES_FROM_BROWSER) {
    args.push("--cookies-from-browser", process.env.GALLERY_DL_COOKIES_FROM_BROWSER);
  }
  return args;
}

// gallery-dl `-j` emits a JSON array of `[messageType, ...args]` tuples.
const MSG_ERROR = -1; // [-1, {error, message}] -> extractor aborted
const MSG_DIRECTORY = 2; // [2, kwdict]            -> post-level metadata
const MSG_URL = 3; // [3, url, kwdict]       -> one downloadable file
const MSG_QUEUE = 6; // [6, url, kwdict]       -> a URL to resolve in a separate pass

// Share/short links (reddit.com/r/x/s/y, redd.it/y) resolve to a single queued
// canonical permalink; we follow it. Bounded to avoid loops/listing pages.
const MAX_RESOLVE_DEPTH = 2;

// Reddit nests video facts under `media.reddit_video`; `secure_media` mirrors it
// for over-18 posts. These are the authoritative source for duration/dims/audio.
const RedditVideo = z
  .object({
    duration: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    has_audio: z.boolean().optional(),
  })
  .passthrough();

/**
 * Subset of the Reddit extractor's metadata we care about; tolerant of extras.
 * gallery-dl yields Reddit's raw submission dict, so these are Reddit API field
 * names. Per-asset width/height are intentionally absent here — the extractor
 * doesn't emit them, so dimensions come from the downloaded file instead.
 */
const Kw = z
  .object({
    title: z.string().optional(),
    subreddit: z.string().optional(),
    over_18: z.boolean().optional(),
    score: z.number().optional(),
    domain: z.string().optional(),
    permalink: z.string().optional(),
    is_video: z.boolean().optional(),
    // Reddit sends `null` (not absent) for these on non-video posts -> nullish.
    media: z.object({ reddit_video: RedditVideo.optional() }).passthrough().nullish(),
    secure_media: z.object({ reddit_video: RedditVideo.optional() }).passthrough().nullish(),
  })
  .passthrough();
type Kw = z.infer<typeof Kw>;

/** Tolerant parse: an unexpected submission shape degrades to {}, never throws. */
function parseKw(value: unknown): Kw {
  const result = Kw.safeParse(value);
  if (result.success) return result.data;
  if (process.env.NODE_ENV !== "production") {
    console.error("[gallery-dl] kw parse fell back:", result.error.issues);
  }
  return {};
}

interface UrlEntry {
  url: string;
  kw: Kw;
}

/**
 * Extract a Reddit post's media metadata via gallery-dl. No bytes are
 * downloaded — this feeds the live cards and most of the analytics.
 */
export async function extractPost(rawUrl: string): Promise<ResolvedPost> {
  return extractAt(rawUrl, 0);
}

async function extractAt(rawUrl: string, depth: number): Promise<ResolvedPost> {
  const stdout = await runGalleryDl(["-j", "--", rawUrl]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new RedditFetchError("invalid_response", "gallery-dl no devolvió JSON válido.");
  }

  const entries = z.array(z.array(z.unknown())).safeParse(parsed);
  if (!entries.success) {
    throw new RedditFetchError("invalid_response", "Formato inesperado de gallery-dl.");
  }

  let meta: Kw = {};
  const urls: UrlEntry[] = [];
  const queued: string[] = [];
  for (const entry of entries.data) {
    const type = entry[0];
    if (type === MSG_ERROR) {
      throw errorFromAbort(entry[1]);
    } else if (type === MSG_DIRECTORY && entry[1]) {
      meta = { ...meta, ...parseKw(entry[1]) };
    } else if (type === MSG_URL && typeof entry[1] === "string") {
      urls.push({ url: entry[1], kw: entry[2] ? parseKw(entry[2]) : {} });
    } else if (type === MSG_QUEUE && typeof entry[1] === "string") {
      queued.push(entry[1]);
    }
  }

  // A share/short link resolves to exactly one queued canonical permalink:
  // follow it. More than one queued URL means a listing/multi-post page, which
  // is out of scope (we resolve single posts only).
  if (urls.length === 0 && queued.length === 1 && depth < MAX_RESOLVE_DEPTH) {
    return extractAt(queued[0], depth + 1);
  }

  // Fall back to the first file's kwdict for post-level fields if there was no
  // directory message.
  if (urls[0]) meta = { ...urls[0].kw, ...meta };

  return normalize(rawUrl, meta, urls);
}

function normalize(rawUrl: string, meta: Kw, urls: UrlEntry[]): ResolvedPost {
  const permalink = meta.permalink
    ? `https://www.reddit.com${meta.permalink}`.replace(/\/+$/, "")
    : rawUrl;

  const base = {
    permalink,
    subreddit: meta.subreddit ?? "unknown",
    title: meta.title ?? "reddit-post",
    domain: meta.domain ?? hostnameOf(urls[0]?.url) ?? "",
    isNsfw: meta.over_18 ?? false,
    score: typeof meta.score === "number" ? meta.score : null,
  };

  const isVideo =
    meta.is_video === true ||
    urls.some((u) => u.url.startsWith("ytdl:") || /\bv\.redd\.it\b/.test(u.url));

  if (isVideo) {
    const rv = meta.media?.reddit_video ?? meta.secure_media?.reddit_video;
    return {
      ...base,
      postType: "video",
      assets: [],
      video: {
        durationSeconds: rv?.duration,
        width: rv?.width,
        height: rv?.height,
        hasAudio: rv?.has_audio,
      },
    };
  }

  // The extractor doesn't emit per-asset dimensions; they're filled from the
  // downloaded file at download time (Strategy B).
  const assets: MediaAsset[] = urls.map((u) => ({ url: u.url }));

  if (assets.length > 1) return { ...base, postType: "gallery", assets };
  if (assets.length === 1) return { ...base, postType: "image", assets };

  return {
    ...base,
    postType: "external",
    assets: [],
    unsupportedReason: base.domain
      ? `gallery-dl no encontró media descargable (dominio: ${base.domain}).`
      : "gallery-dl no encontró media descargable en este post.",
  };
}

/**
 * Strategy B download: have gallery-dl fetch all of a post's media into a fresh
 * temp dir, returning the files (in gallery order) with sizes. gallery-dl does
 * the fetching, so this works for any host it supports (i.redd.it, redgifs,
 * imgur, …) — no per-host allowlist needed, unlike the old CDN proxy.
 *
 * v.redd.it videos are NOT downloaded here; they stay on the yt-dlp path
 * (DASH+audio merge). The caller routes by post type.
 *
 * The returned `cleanup` MUST be called once the files have been served.
 */
export async function downloadMedia(rawUrl: string): Promise<DownloadedMedia> {
  const dir = await mkdtemp(join(tmpdir(), "reddit-gdl-"));
  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    // `{num}` is gallery-dl's per-file index, so names sort back into post order.
    await execFileAsync(
      GALLERY_DL,
      [...authArgs(), "-D", dir, "-f", "{num}.{extension}", "--", rawUrl],
      { timeout: DOWNLOAD_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
    );

    const names = (await readdir(dir)).filter((n) => !n.startsWith("."));
    names.sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
    const files = await Promise.all(
      names.map(async (n) => {
        const path = join(dir, n);
        return { path, sizeBytes: (await stat(path)).size };
      }),
    );
    if (files.length === 0) {
      throw new RedditFetchError("invalid_response", "gallery-dl no descargó ningún archivo.");
    }
    return { dir, files, cleanup };
  } catch (err) {
    await cleanup();
    throw err instanceof RedditFetchError ? err : toFetchError(err);
  }
}

/** Run gallery-dl, mapping spawn/exit failures to typed `RedditFetchError`s. */
async function runGalleryDl(args: string[]): Promise<string> {
  const debug = process.env.NODE_ENV !== "production";
  if (debug) {
    // Which auth levers the app process actually sees (no secrets), so we can
    // tell whether the cookies flag reached gallery-dl at all.
    console.error("[gallery-dl] auth:", {
      cookiesFromBrowser: process.env.GALLERY_DL_COOKIES_FROM_BROWSER ?? null,
      cookiesFile: process.env.GALLERY_DL_COOKIES ?? null,
      config: process.env.GALLERY_DL_CONFIG ?? null,
      oauth: Boolean(process.env.REDDIT_REFRESH_TOKEN),
    });
  }
  try {
    const { stdout, stderr } = await execFileAsync(GALLERY_DL, [...authArgs(), ...args], {
      timeout: EXTRACT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    // gallery-dl logs "[cookies][info] Extracted N cookies from Chrome" (or a
    // warning if it couldn't read them) to stderr — the decisive diagnostic.
    if (debug && stderr.trim()) console.error("[gallery-dl] stderr:", stderr.trim());
    return stdout;
  } catch (err) {
    if (debug) {
      const e = err as { stderr?: string };
      if (e?.stderr?.trim()) console.error("[gallery-dl] stderr:", e.stderr.trim());
    }
    throw toFetchError(err);
  }
}

/** Map a gallery-dl `[-1, {error, message}]` abort entry to a typed error. */
function errorFromAbort(payload: unknown): RedditFetchError {
  const p = payload as { error?: string; message?: string } | undefined;
  // The decisive phrase can sit at the END of a huge HTML/CSS block page, so
  // scan the whole message (capped), not just the head.
  const msg = (p?.message ?? "").slice(0, 100_000).toLowerCase();
  if (
    msg.includes("blocked by network security") ||
    msg.includes("403") ||
    msg.includes("forbidden")
  ) {
    return new RedditFetchError(
      "forbidden",
      "Reddit bloqueó el acceso (WAF/IP o falta de OAuth). Probá configurar REDDIT_USER_AGENT, REDDIT_REFRESH_TOKEN o GALLERY_DL_COOKIES.",
    );
  }
  if (msg.includes("404") || msg.includes("not found")) {
    return new RedditFetchError("not_found", "Reddit no encontró el post (404).");
  }
  if (msg.includes("429") || msg.includes("too many requests")) {
    return new RedditFetchError("rate_limit", "Reddit limitó las peticiones (429). Reintentá luego.");
  }
  return new RedditFetchError(
    "network",
    `gallery-dl abortó la extracción: ${p?.error ?? "error desconocido"}.`,
  );
}

function toFetchError(err: unknown): RedditFetchError {
  const e = err as { code?: string; killed?: boolean; stderr?: string };
  if (e?.code === "ENOENT") {
    return new RedditFetchError(
      "network",
      "gallery-dl no está instalado o no se encuentra en el PATH (configurá GALLERY_DL_PATH).",
    );
  }
  if (e?.killed) {
    return new RedditFetchError("network", "gallery-dl excedió el tiempo límite.");
  }
  const stderr = (e?.stderr ?? "").toLowerCase();
  if (stderr.includes("404") || stderr.includes("not found")) {
    return new RedditFetchError("not_found", "Reddit no encontró el post (404).");
  }
  if (stderr.includes("403") || stderr.includes("401") || stderr.includes("forbidden")) {
    return new RedditFetchError("forbidden", "Reddit denegó el acceso al post (403).");
  }
  if (stderr.includes("429") || stderr.includes("too many requests")) {
    return new RedditFetchError("rate_limit", "Reddit limitó las peticiones (429). Reintentá luego.");
  }
  return new RedditFetchError("network", "gallery-dl falló al extraer el post.");
}

function hostnameOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url.replace(/^ytdl:/, "")).hostname;
  } catch {
    return undefined;
  }
}
