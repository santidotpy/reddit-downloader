/**
 * Per-item download memo for Strategy B.
 *
 * A gallery has N assets but they all come from one gallery-dl run, and the
 * media route is hit once per asset. Without memoization each asset request
 * would re-download the whole post. So we cache the in-flight/most-recent
 * `downloadMedia` promise per job item, and evict (deleting the temp dir) after
 * a TTL. Lives on `globalThis` so it survives HMR in dev, like the job queue.
 */
import { downloadMedia, type DownloadedMedia } from "@/lib/gallerydl";

const TTL_MS = 15 * 60 * 1000;

interface Entry {
  media: Promise<DownloadedMedia>;
  timer: ReturnType<typeof setTimeout>;
}

const globalForCache = globalThis as unknown as {
  __redditDownloadCache?: Map<string, Entry>;
};

function getCache(): Map<string, Entry> {
  if (!globalForCache.__redditDownloadCache) {
    globalForCache.__redditDownloadCache = new Map();
  }
  return globalForCache.__redditDownloadCache;
}

/**
 * Download (once) all media for a job item and return it. Concurrent/repeat
 * callers for the same item share the same temp dir; it's cleaned up TTL_MS
 * after the first request.
 */
export function getItemMedia(itemId: string, rawUrl: string): Promise<DownloadedMedia> {
  const cache = getCache();
  const existing = cache.get(itemId);
  if (existing) return existing.media;

  const media = downloadMedia(rawUrl);
  const timer = setTimeout(() => {
    cache.delete(itemId);
    void media.then((m) => m.cleanup()).catch(() => {});
  }, TTL_MS);
  // Don't keep the event loop alive just for cleanup.
  if (typeof timer.unref === "function") timer.unref();

  cache.set(itemId, { media, timer });

  // If the download itself failed, don't cache the rejection — let a retry try
  // again rather than returning the same error for TTL_MS.
  media.catch(() => {
    const entry = cache.get(itemId);
    if (entry?.media === media) {
      clearTimeout(entry.timer);
      cache.delete(itemId);
    }
  });

  return media;
}
