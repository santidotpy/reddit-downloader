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
import { promisify } from "node:util";
import { z } from "zod";
import { RedditFetchError } from "@/lib/reddit/errors";
import type { MediaAsset, ResolvedPost } from "@/lib/reddit/types";

const execFileAsync = promisify(execFile);

/** Binary on PATH in dev; in Docker we point this at the standalone binary. */
const GALLERY_DL = process.env.GALLERY_DL_PATH || "gallery-dl";
const EXTRACT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

// gallery-dl `-j` emits a JSON array of `[messageType, ...args]` tuples.
const MSG_DIRECTORY = 2; // [2, kwdict]            -> post-level metadata
const MSG_URL = 3; // [3, url, kwdict]       -> one downloadable file

/** Subset of the Reddit extractor's metadata we care about; tolerant of extras. */
const Kw = z
  .object({
    title: z.string().optional(),
    subreddit: z.string().optional(),
    over_18: z.boolean().optional(),
    score: z.number().optional(),
    domain: z.string().optional(),
    permalink: z.string().optional(),
    is_video: z.boolean().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    duration: z.number().optional(),
  })
  .passthrough();
type Kw = z.infer<typeof Kw>;

interface UrlEntry {
  url: string;
  kw: Kw;
}

/**
 * Extract a Reddit post's media metadata via gallery-dl. No bytes are
 * downloaded — this feeds the live cards and most of the analytics.
 */
export async function extractPost(rawUrl: string): Promise<ResolvedPost> {
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
  for (const entry of entries.data) {
    const type = entry[0];
    if (type === MSG_DIRECTORY && entry[1]) {
      meta = { ...meta, ...Kw.parse(entry[1]) };
    } else if (type === MSG_URL && typeof entry[1] === "string") {
      urls.push({ url: entry[1], kw: entry[2] ? Kw.parse(entry[2]) : {} });
    }
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
    return {
      ...base,
      postType: "video",
      assets: [],
      video: {
        durationSeconds: meta.duration,
        width: meta.width,
        height: meta.height,
      },
    };
  }

  const assets: MediaAsset[] = urls.map((u) => ({
    url: u.url,
    width: u.kw.width,
    height: u.kw.height,
  }));

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

/** Run gallery-dl, mapping spawn/exit failures to typed `RedditFetchError`s. */
async function runGalleryDl(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(GALLERY_DL, args, {
      timeout: EXTRACT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    return stdout;
  } catch (err) {
    throw toFetchError(err);
  }
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
