/**
 * GET /api/download/media?job=&item=&i=
 *
 * Strategy B: the post's media was downloaded by gallery-dl (see
 * `lib/download-cache.ts`); we stream the i-th file straight from the temp dir
 * with a sanitized Content-Disposition. Because gallery-dl did the fetching,
 * this works for any host it supports (i.redd.it, redgifs, imgur, …) — there is
 * no per-host allowlist and the server never fetches a client-supplied URL.
 * v.redd.it videos use the dedicated video route instead.
 */
import type { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { getJob } from "@/lib/queue";
import { getItemMedia } from "@/lib/download-cache";
import { getSessionCookies } from "@/lib/reddit-cookies";
import { contentDisposition, sanitizeFilename } from "@/lib/filename";
import { logDownloadEvent } from "@/lib/db/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

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
  if (item.post.postType === "video") {
    return new Response("Usá el endpoint de video para este ítem.", { status: 400 });
  }

  let media;
  try {
    media = await getItemMedia(itemId, item.post.permalink, getSessionCookies(jobId));
  } catch {
    return new Response("No se pudo descargar el archivo.", { status: 502 });
  }

  const file = media.files[index];
  if (!file) return new Response("Asset no encontrado.", { status: 404 });

  const post = item.post;
  const ext = extname(file.path).toLowerCase();
  const suffix = media.files.length > 1 ? `-${index + 1}` : "";
  const filename = `${sanitizeFilename(post.title)}${suffix}${ext}`;

  // The temp dir is owned by the download cache (TTL eviction), so we do NOT
  // clean up on stream close — other asset indices may still need these files.
  const nodeStream = createReadStream(file.path);
  nodeStream.once("error", () => nodeStream.destroy());
  req.signal.addEventListener("abort", () => nodeStream.destroy());
  nodeStream.once("end", () => {
    void logDownloadEvent({
      post,
      status: "success",
      fileSizeBytes: file.sizeBytes,
      mediaCount: 1,
      hasAudio: false,
      durationSeconds: null,
      width: post.assets[index]?.width ?? null,
      height: post.assets[index]?.height ?? null,
      processingMs: Date.now() - start,
    });
  });

  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  return new Response(webStream, {
    headers: {
      "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "content-length": String(file.sizeBytes),
      "content-disposition": contentDisposition(filename),
      "cache-control": "no-store",
    },
  });
}
