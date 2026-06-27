/**
 * GET /api/jobs/[id]  — Server-Sent Events stream of job progress.
 *
 * Emits `event: update` with a full job snapshot on every item transition, and
 * a final `event: done` once all items are settled, then closes. A periodic
 * comment heartbeat keeps the connection alive through proxies.
 */
import type { NextRequest } from "next/server";
import { getJob, isJobSettled, subscribe, type Job } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!getJob(id)) {
    return new Response("Job no encontrado.", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Mutable holder so `finish` (defined before they're assigned) can still
      // reach the unsubscribe fn and heartbeat timer.
      const refs: {
        closed: boolean;
        unsubscribe?: () => void;
        heartbeat?: ReturnType<typeof setInterval>;
      } = { closed: false };

      const send = (event: string, data: unknown) => {
        if (refs.closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const finish = () => {
        if (refs.closed) return;
        refs.closed = true;
        refs.unsubscribe?.();
        if (refs.heartbeat) clearInterval(refs.heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const onUpdate = (snapshot: Job) => {
        send("update", snapshot);
        if (isJobSettled(snapshot)) {
          send("done", { jobId: snapshot.id });
          finish();
        }
      };

      // Subscribe before reading the snapshot so we don't miss transitions.
      refs.unsubscribe = subscribe(id, onUpdate);

      const current = getJob(id);
      if (current) {
        send("update", current);
        if (isJobSettled(current)) {
          send("done", { jobId: current.id });
          finish();
          return;
        }
      }

      refs.heartbeat = setInterval(() => {
        if (!refs.closed) controller.enqueue(encoder.encode(`: ping\n\n`));
      }, HEARTBEAT_MS);

      // Client disconnected — clean up listeners/timers.
      req.signal.addEventListener("abort", finish);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
