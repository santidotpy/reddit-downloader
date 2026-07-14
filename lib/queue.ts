/**
 * In-memory job queue for multi-URL extraction.
 *
 * Each submitted batch becomes a `Job` with one `JobItem` per URL. Items are
 * processed through a shared `p-queue` with limited concurrency (so we never
 * hammer Reddit), and every state transition is pushed to subscribers via an
 * EventEmitter — this is what the SSE endpoint streams to the client.
 *
 * State lives in process memory. That is intentional for a single stateless
 * container (the only durable data is the anonymous download log in Neon). If
 * this ever runs multiple replicas, this store must move to something shared.
 */
import PQueue from "p-queue";
import { EventEmitter } from "node:events";
import { processRedditUrl } from "@/lib/reddit";
import { NonRedditHostError, RedditFetchError } from "@/lib/reddit/errors";
import {
  clearSessionCookies,
  getSessionCookies,
  storeSessionCookies,
  type RedditCookies,
} from "@/lib/reddit-cookies";
import type { Job, JobItemError } from "@/lib/job-types";

export type { ItemStatus, Job, JobItem, JobItemError } from "@/lib/job-types";

const CONCURRENCY = 3;
const JOB_TTL_MS = 60 * 60 * 1000; // evict finished jobs after 1h

interface QueueState {
  queue: PQueue;
  jobs: Map<string, Job>;
  emitter: EventEmitter;
}

// Single shared instance per server process; also survives HMR in dev.
const globalForQueue = globalThis as unknown as { __redditQueue?: QueueState };

function getState(): QueueState {
  if (!globalForQueue.__redditQueue) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0); // many concurrent SSE subscribers
    globalForQueue.__redditQueue = {
      queue: new PQueue({ concurrency: CONCURRENCY }),
      jobs: new Map(),
      emitter,
    };
  }
  return globalForQueue.__redditQueue;
}

/** Deep copy so SSE payloads are decoupled from later in-place mutation. */
function snapshot(job: Job): Job {
  return structuredClone(job);
}

function emit(state: QueueState, job: Job): void {
  state.emitter.emit(job.id, snapshot(job));
}

function toItemError(err: unknown): JobItemError {
  if (err instanceof RedditFetchError) return { kind: err.kind, message: err.message };
  if (err instanceof NonRedditHostError) {
    return { kind: "non_reddit_host", message: err.message };
  }
  return {
    kind: "unknown",
    message: err instanceof Error ? err.message : "Error desconocido al procesar la URL.",
  };
}

function sweep(state: QueueState): void {
  const now = Date.now();
  for (const [id, job] of state.jobs) {
    if (now - job.createdAt > JOB_TTL_MS) {
      state.jobs.delete(id);
      // Drop any in-memory session cookies tied to this job alongside it.
      clearSessionCookies(id);
    }
  }
}

/**
 * Create a job for the given URLs and enqueue each item for processing.
 *
 * `cookies` (optional) are the per-session Reddit cookies from the paste /
 * bookmarklet UI flows. They are held in a separate in-memory store keyed by
 * job id — NOT on the `Job` (which is serialized into SSE frames) — so the later
 * download requests for this job can reuse them without the client re-sending.
 */
export function createJob(rawUrls: string[], cookies?: RedditCookies): Job {
  const state = getState();
  sweep(state);

  const job: Job = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    items: rawUrls.map((rawUrl) => ({
      id: crypto.randomUUID(),
      rawUrl,
      status: "queued",
    })),
  };
  state.jobs.set(job.id, job);
  if (cookies) storeSessionCookies(job.id, cookies);

  for (const item of job.items) {
    void state.queue.add(async () => {
      item.status = "processing";
      emit(state, job);
      try {
        item.post = await processRedditUrl(item.rawUrl, getSessionCookies(job.id));
        item.status = "ready";
      } catch (err) {
        item.status = "failed";
        item.error = toItemError(err);
      }
      emit(state, job);
    });
  }

  return job;
}

export function getJob(id: string): Job | undefined {
  return getState().jobs.get(id);
}

export function isJobSettled(job: Job): boolean {
  return job.items.every((i) => i.status === "ready" || i.status === "failed");
}

/** Subscribe to snapshots for a job. Returns an unsubscribe function. */
export function subscribe(jobId: string, listener: (job: Job) => void): () => void {
  const { emitter } = getState();
  emitter.on(jobId, listener);
  return () => emitter.off(jobId, listener);
}
