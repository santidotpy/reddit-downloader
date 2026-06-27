/**
 * Public surface of the Reddit extraction pipeline.
 *
 * `processRedditUrl` is the end-to-end path used by the queue in phase 2:
 *   resolve short/share link -> fetch .json -> classify.
 */
import { resolveRedditUrl } from "./url";
import { fetchPostJson } from "./fetch-json";
import { classifyPost } from "./classify";
import type { ResolvedPost } from "./types";

export async function processRedditUrl(rawUrl: string): Promise<ResolvedPost> {
  const permalink = await resolveRedditUrl(rawUrl);
  const post = await fetchPostJson(permalink);
  return classifyPost(post, permalink);
}

export * from "./types";
export * from "./errors";
export { detectRedditUrls, isRedditHost, resolveRedditUrl } from "./url";
export { fetchPostJson } from "./fetch-json";
export { classifyPost } from "./classify";
