/**
 * GET /api/download/video?job=&item=
 *
 * Downloads + merges a v.redd.it video (yt-dlp + ffmpeg) to a temp file,
 * streams it to the client, and deletes the temp dir once the stream closes
 * (whether it finished, errored, or the client aborted).
 */
import type { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getJob } from "@/lib/queue";
import { downloadVideo } from "@/lib/ytdlp";
import { contentDisposition, sanitizeFilename } from "@/lib/filename";
import { logDownloadEvent } from "@/lib/db/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const start = Date.now();
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("job");
  const itemId = searchParams.get("item");
  if (!jobId || !itemId) {
    return new Response("Faltan parámetros.", { status: 400 });
  }

  const item = getJob(jobId)?.items.find((i) => i.id === itemId);
  if (!item?.post) return new Response("Ítem no encontrado.", { status: 404 });
  if (item.post.postType !== "video") {
    return new Response("El ítem no es un video.", { status: 400 });
  }

  let download;
  try {
    download = await downloadVideo(item.post.permalink);
  } catch {
    return new Response("No se pudo descargar el video.", { status: 502 });
  }

  const { filePath, cleanup } = download;
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    await cleanup();
    return new Response("El archivo de video no está disponible.", { status: 500 });
  }

  const post = item.post;
  const nodeStream = createReadStream(filePath);
  // `close` fires on normal end, error, and destroy — single cleanup point.
  nodeStream.once("close", () => void cleanup());
  nodeStream.once("error", () => nodeStream.destroy());
  req.signal.addEventListener("abort", () => nodeStream.destroy());
  // `end` only fires on a fully-read stream — log success there, not on abort.
  nodeStream.once("end", () => {
    void logDownloadEvent({
      post,
      status: "success",
      fileSizeBytes: size,
      mediaCount: 1,
      hasAudio: Boolean(post.video?.hasAudio),
      durationSeconds: post.video?.durationSeconds ?? null,
      processingMs: Date.now() - start,
    });
  });

  const filename = `${sanitizeFilename(post.title)}.mp4`;
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    headers: {
      "content-type": "video/mp4",
      "content-length": String(size),
      "content-disposition": contentDisposition(filename),
      "cache-control": "no-store",
    },
  });
}
