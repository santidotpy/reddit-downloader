/**
 * Public surface of the Reddit extraction pipeline.
 *
 * `processRedditUrl` is the end-to-end path used by the queue: it now delegates
 * link resolution + metadata extraction to gallery-dl (see `lib/gallerydl.ts`),
 * which returns a normalized `ResolvedPost`. The legacy modules (`fetch-json`,
 * `classify`, `resolveRedditUrl`) are kept for reference/fallback but are no
 * longer on the hot path.
 */
import { extractPost } from "@/lib/gallerydl";
import type { ResolvedPost } from "./types";

export async function processRedditUrl(rawUrl: string): Promise<ResolvedPost> {
  return extractPost(rawUrl);
}

export * from "./types";
export * from "./errors";
export { detectRedditUrls, isRedditHost, isRedditMediaHost } from "./url";
