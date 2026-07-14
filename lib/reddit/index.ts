/**
 * Public surface of the Reddit extraction pipeline.
 *
 * `processRedditUrl` is the end-to-end path used by the queue: it delegates link
 * resolution + metadata extraction to gallery-dl (see `lib/gallerydl.ts`), which
 * returns a normalized `ResolvedPost`.
 */
import { extractPost } from "@/lib/gallerydl";
import type { RedditCookies } from "@/lib/reddit-cookies";
import type { ResolvedPost } from "./types";

export async function processRedditUrl(
  rawUrl: string,
  cookies?: RedditCookies,
): Promise<ResolvedPost> {
  return extractPost(rawUrl, cookies);
}

export * from "./types";
export * from "./errors";
export { detectRedditUrls, isRedditHost, isRedditMediaHost } from "./url";
