/**
 * yt-dlp wrapper (via youtube-dl-exec) for v.redd.it videos.
 *
 * v.redd.it serves video and audio as separate streams; yt-dlp + ffmpeg merge
 * them into a single mp4. The merged file is written to a unique temp dir; the
 * returned `cleanup` MUST be called once the file has been served.
 *
 * In dev, ffmpeg comes from `ffmpeg-static`. In the Docker image ffmpeg is
 * installed system-wide and found on PATH, so we only pass `ffmpegLocation`
 * when the static binary is present.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import youtubedl, { create as createYoutubeDl } from "youtube-dl-exec";
import ffmpegStatic from "ffmpeg-static";

export interface VideoDownload {
  filePath: string;
  cleanup: () => Promise<void>;
}

const DOWNLOAD_TIMEOUT_MS = 4 * 60 * 1000;

// In production (Docker) use the system yt-dlp + ffmpeg via env vars — the
// standalone Next build doesn't copy node_modules binaries, and the system
// yt-dlp binary needs no Python. In dev, fall back to the bundled binaries.
const ytdlp = process.env.YT_DLP_PATH
  ? createYoutubeDl(process.env.YT_DLP_PATH)
  : youtubedl;

const ffmpegLocation = process.env.FFMPEG_PATH || ffmpegStatic || undefined;

/** Download + merge a Reddit video to a temp file. Throws on failure (after cleanup). */
export async function downloadVideo(permalink: string): Promise<VideoDownload> {
  const dir = await mkdtemp(join(tmpdir(), "reddit-dl-"));
  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    await ytdlp(permalink, {
      output: join(dir, "video.%(ext)s"),
      format: "bestvideo*+bestaudio/best",
      mergeOutputFormat: "mp4",
      noPlaylist: true,
      noWarnings: true,
      retries: 3,
      ...(ffmpegLocation ? { ffmpegLocation } : {}),
    });

    const files = await readdir(dir);
    const file = files.find((f) => f.startsWith("video.")) ?? files[0];
    if (!file) throw new Error("yt-dlp no generó ningún archivo.");

    return { filePath: join(dir, file), cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

export const VIDEO_DOWNLOAD_TIMEOUT_MS = DOWNLOAD_TIMEOUT_MS;
