/**
 * Anonymous download-event logging.
 *
 * Fire-and-forget: a logging failure (or missing DB) must never break a
 * download. We record ONLY content-derived facts — never anything that
 * identifies the requester.
 */
import { getDb } from "./index";
import { downloadEvents, type NewDownloadEvent } from "./schema";
import type { ResolvedPost } from "@/lib/reddit/types";

export interface DownloadLog {
  post: ResolvedPost;
  status: "success" | "failed";
  fileSizeBytes: number;
  mediaCount: number;
  hasAudio: boolean;
  durationSeconds: number | null;
  processingMs: number;
}

export async function logDownloadEvent(input: DownloadLog): Promise<void> {
  const db = getDb();
  if (!db) return;

  const row: NewDownloadEvent = {
    subreddit: input.post.subreddit,
    postType: input.post.postType,
    domain: input.post.domain,
    isNsfw: input.post.isNsfw,
    hasAudio: input.hasAudio,
    mediaCount: input.mediaCount,
    fileSizeBytes: Math.max(0, Math.round(input.fileSizeBytes)),
    durationSeconds: input.durationSeconds,
    redditScore: input.post.score,
    status: input.status,
    processingMs: Math.max(0, Math.round(input.processingMs)),
  };

  try {
    await db.insert(downloadEvents).values(row);
  } catch (err) {
    console.error("logDownloadEvent failed:", err);
  }
}
