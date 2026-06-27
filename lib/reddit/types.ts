/**
 * Domain types for resolved Reddit posts.
 *
 * A `ResolvedPost` is the normalized output of the extraction pipeline
 * (resolve short link -> fetch .json -> classify). It is intentionally
 * decoupled from Reddit's raw JSON shape so the rest of the app never
 * touches Reddit's wire format directly.
 */

export type PostType = "image" | "gallery" | "video" | "external";

export interface MediaAsset {
  /** Direct, downloadable media URL (already unescaped via raw_json=1). */
  url: string;
  width?: number;
  height?: number;
  mimeType?: string;
  /** True for animated gallery items (we prefer the mp4/gif source). */
  isAnimated?: boolean;
}

export interface ResolvedVideo {
  /** v.redd.it video-only stream (no audio); merged with audio by yt-dlp at download time. */
  fallbackUrl?: string;
  dashUrl?: string;
  hlsUrl?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  /**
   * Best-effort flag from Reddit. Not always present and not authoritative —
   * the real answer is confirmed when yt-dlp merges the streams.
   */
  hasAudio?: boolean;
}

export interface ResolvedPost {
  /** Canonical https permalink the post was resolved to. */
  permalink: string;
  subreddit: string;
  title: string;
  postType: PostType;
  domain: string;
  isNsfw: boolean;
  score: number | null;
  thumbnail?: string;
  /** Populated for `image` and `gallery`. Empty for `video`/`external`. */
  assets: MediaAsset[];
  /** Populated for `video`. */
  video?: ResolvedVideo;
  /** Human-readable reason set only for `external` (unsupported) posts. */
  unsupportedReason?: string;
}
