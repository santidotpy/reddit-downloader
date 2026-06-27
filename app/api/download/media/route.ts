/**
 * GET /api/download/media?job=&item=&i=
 *
 * Proxies a single image / gallery asset and serves it with a sanitized
 * Content-Disposition filename. The URL is read from server-held job state (not
 * from the client) and the host must be a Reddit media CDN — so this can't be
 * abused as an open proxy. The upstream body is streamed, never buffered.
 */
import type { NextRequest } from "next/server";
import { getJob } from "@/lib/queue";
import { isRedditMediaHost } from "@/lib/reddit/url";
import { getRedditUserAgent } from "@/lib/reddit/user-agent";
import {
  contentDisposition,
  extFromMime,
  extFromUrl,
  sanitizeFilename,
} from "@/lib/filename";
import { logDownloadEvent } from "@/lib/db/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 30_000;

export async function GET(req: NextRequest) {
  const start = Date.now();
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("job");
  const itemId = searchParams.get("item");
  const parsedIndex = Number.parseInt(searchParams.get("i") ?? "0", 10);
  const index = Number.isFinite(parsedIndex) && parsedIndex >= 0 ? parsedIndex : 0;

  if (!jobId || !itemId) {
    return new Response("Faltan parámetros.", { status: 400 });
  }

  const item = getJob(jobId)?.items.find((i) => i.id === itemId);
  if (!item?.post) return new Response("Ítem no encontrado.", { status: 404 });

  const asset = item.post.assets[index];
  if (!asset) return new Response("Asset no encontrado.", { status: 404 });

  let target: URL;
  try {
    target = new URL(asset.url);
  } catch {
    return new Response("URL de media inválida.", { status: 400 });
  }
  if (!isRedditMediaHost(target.hostname)) {
    return new Response("Host no permitido.", { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: { "user-agent": getRedditUserAgent() },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return new Response("No se pudo obtener el archivo.", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response("No se pudo obtener el archivo.", { status: 502 });
  }

  const ext =
    extFromUrl(asset.url) ||
    extFromMime(asset.mimeType) ||
    extFromMime(upstream.headers.get("content-type"));
  const suffix = item.post.assets.length > 1 ? `-${index + 1}` : "";
  const filename = `${sanitizeFilename(item.post.title)}${suffix}${ext}`;

  const headers = new Headers();
  headers.set(
    "content-type",
    upstream.headers.get("content-type") ?? asset.mimeType ?? "application/octet-stream",
  );
  const length = upstream.headers.get("content-length");
  if (length) headers.set("content-length", length);
  headers.set("content-disposition", contentDisposition(filename));
  headers.set("cache-control", "no-store");

  // Count bytes as they stream through and log an anonymous event once the
  // download actually completes (flush). Aborted downloads aren't logged.
  const post = item.post;
  let bytes = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
    flush() {
      void logDownloadEvent({
        post,
        status: "success",
        fileSizeBytes: bytes,
        mediaCount: 1,
        hasAudio: false,
        durationSeconds: null,
        processingMs: Date.now() - start,
      });
    },
  });

  return new Response(upstream.body.pipeThrough(counter), { headers });
}
