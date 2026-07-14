/**
 * Serializable job/item types shared between server (queue, route handlers) and
 * client (UI, hooks). Kept free of any Node-only imports so it's safe to bundle
 * into client components. The impl lives in `lib/queue.ts`.
 */
import type { ResolvedPost } from "@/lib/reddit/types";

export type ItemStatus = "queued" | "processing" | "ready" | "failed";

export interface JobItemError {
  kind: string;
  message: string;
}

export interface JobItem {
  id: string;
  rawUrl: string;
  status: ItemStatus;
  post?: ResolvedPost;
  error?: JobItemError;
}

export interface Job {
  id: string;
  createdAt: number;
  items: JobItem[];
}
