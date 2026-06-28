/**
 * POST /api/download/zip  { jobId, itemIds }
 *
 * Streams a ZIP of the requested items (a single gallery, or multiple posts).
 * Image/gallery assets are streamed straight from the Reddit CDN into the
 * archive; videos are merged via yt-dlp to a temp file, added, then cleaned up
 * once the archive is fully flushed. Per-asset failures are skipped, not fatal.
 */
import type { NextRequest } from "next/server";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { stat } from "node:fs/promises";
import { ZipArchive } from "archiver";
import { z } from "zod";
import { getJob } from "@/lib/queue";
import { isRedditMediaHost } from "@/lib/reddit/url";
import { getRedditUserAgent } from "@/lib/reddit/user-agent";
import { downloadVideo } from "@/lib/ytdlp";
import {
  contentDisposition,
  extFromMime,
  extFromUrl,
  sanitizeFilename,
} from "@/lib/filename";
import { logDownloadEvent, type DownloadLog } from "@/lib/db/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FETCH_TIMEOUT_MS = 30_000;

const bodySchema = z.object({
  jobId: z.string().min(1),
  itemIds: z.array(z.string().min(1)).min(1),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Body inválido." }, { status: 400 });
  }

  const job = getJob(parsed.data.jobId);
  if (!job) return Response.json({ error: "Job no encontrado." }, { status: 404 });

  const wanted = new Set(parsed.data.itemIds);
  const items = job.items.filter(
    (i) =>
      wanted.has(i.id) &&
      i.status === "ready" &&
      i.post &&
      i.post.postType !== "external",
  );
  if (items.length === 0) {
    return Response.json({ error: "No hay ítems descargables." }, { status: 422 });
  }

  // level 0 (store): images/videos are already compressed, so deflate just
  // burns CPU. archiver is a Node Readable we adapt to a web stream.
  const archive = new ZipArchive({ zlib: { level: 0 } });
  archive.on("warning", () => {});
  archive.on("error", () => {});

  const usedNames = new Set<string>();
  const cleanups: Array<() => Promise<void>> = [];
  const start = Date.now();
  // One anonymous event per item that was actually added; flushed on archive end.
  const pending: Array<Omit<DownloadLog, "processingMs">> = [];

  void (async () => {
    try {
      for (const item of items) {
        const post = item.post!;
        const base = sanitizeFilename(post.title);

        if (post.postType === "video") {
          try {
            const { filePath, cleanup } = await downloadVideo(post.permalink);
            cleanups.push(cleanup);
            archive.file(filePath, { name: uniqueName(usedNames, `${base}.mp4`) });
            const size = await stat(filePath)
              .then((s) => s.size)
              .catch(() => 0);
            pending.push({
              post,
              status: "success",
              fileSizeBytes: size,
              mediaCount: 1,
              hasAudio: Boolean(post.video?.hasAudio),
              durationSeconds: post.video?.durationSeconds ?? null,
              width: post.video?.width ?? null,
              height: post.video?.height ?? null,
            });
          } catch {
            // skip a video that fails to download
          }
          continue;
        }

        // image or gallery
        let itemBytes = 0;
        let added = 0;
        for (let idx = 0; idx < post.assets.length; idx++) {
          const asset = post.assets[idx];
          let url: URL;
          try {
            url = new URL(asset.url);
          } catch {
            continue;
          }
          if (!isRedditMediaHost(url.hostname)) continue;

          try {
            const res = await fetch(url, {
              headers: { "user-agent": getRedditUserAgent() },
              signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            if (!res.ok || !res.body) continue;
            const ext = extFromUrl(asset.url) || extFromMime(asset.mimeType);
            const suffix = post.assets.length > 1 ? `-${idx + 1}` : "";
            // fetch returns a DOM ReadableStream; Readable.fromWeb wants Node's.
            archive.append(
              Readable.fromWeb(res.body as unknown as NodeReadableStream),
              { name: uniqueName(usedNames, `${base}${suffix}${ext}`) },
            );
            added += 1;
            itemBytes += Number(res.headers.get("content-length") ?? 0);
          } catch {
            continue;
          }
        }
        if (added > 0) {
          pending.push({
            post,
            status: "success",
            fileSizeBytes: itemBytes,
            mediaCount: added,
            hasAudio: false,
            durationSeconds: null,
            width: post.assets[0]?.width ?? null,
            height: post.assets[0]?.height ?? null,
          });
        }
      }
      await archive.finalize();
    } catch {
      archive.abort();
    }
  })();

  // Once the archive is fully written: clean up temp dirs and log events.
  archive.on("end", () => {
    void Promise.all(cleanups.map((c) => c()));
    const processingMs = Date.now() - start;
    for (const event of pending) {
      void logDownloadEvent({ ...event, processingMs });
    }
  });

  // Archiver extends stream.Transform (a Readable); adapt to a web stream.
  const webStream = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": contentDisposition("reddit-downloads.zip"),
      "cache-control": "no-store",
    },
  });
}

/** Ensure a unique entry name within the archive (appends " (2)", " (3)", …). */
function uniqueName(used: Set<string>, name: string): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 2;
  let candidate = `${stem} (${n})${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${stem} (${n})${ext}`;
  }
  used.add(candidate);
  return candidate;
}
