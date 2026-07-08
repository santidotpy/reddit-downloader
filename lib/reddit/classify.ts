/**
 * Classify a Reddit post into image | gallery | video | external and extract
 * its direct media. `external` posts are returned (not thrown) with an
 * `unsupportedReason` so the UI can show them gracefully.
 */
import { untitledPostTitle } from "@/lib/filename";
import type { RedditPostData } from "./schema";
import type { MediaAsset, ResolvedPost } from "./types";

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i;

export function classifyPost(
  post: RedditPostData,
  permalink: string,
): ResolvedPost {
  const base = {
    permalink,
    subreddit: post.subreddit ?? "unknown",
    title: post.title ?? untitledPostTitle(permalink, post.id),
    domain: post.domain ?? hostnameOf(directUrl(post)) ?? "",
    isNsfw: post.over_18 ?? false,
    score: typeof post.score === "number" ? post.score : null,
    thumbnail: isHttpUrl(post.thumbnail) ? post.thumbnail : undefined,
  };

  // Gallery: needs both the ordering (gallery_data) and the assets (media_metadata).
  if (post.is_gallery && post.gallery_data?.items.length && post.media_metadata) {
    const assets = extractGalleryAssets(post);
    if (assets.length > 0) return { ...base, postType: "gallery", assets };
  }

  // Video: hosted v.redd.it. Audio is merged by yt-dlp at download time.
  const redditVideo = post.media?.reddit_video ?? post.secure_media?.reddit_video;
  if ((post.is_video && redditVideo) || base.domain === "v.redd.it") {
    return {
      ...base,
      postType: "video",
      assets: [],
      video: {
        fallbackUrl: redditVideo?.fallback_url,
        dashUrl: redditVideo?.dash_url,
        hlsUrl: redditVideo?.hls_url,
        durationSeconds: redditVideo?.duration,
        width: redditVideo?.width,
        height: redditVideo?.height,
        hasAudio: redditVideo?.has_audio,
      },
    };
  }

  // Single image (i.redd.it or a direct image link).
  const url = directUrl(post);
  if (url && (base.domain === "i.redd.it" || post.post_hint === "image" || IMAGE_EXT.test(url))) {
    return { ...base, postType: "image", assets: [{ url }] };
  }

  // Everything else: unsupported for now, but reported gracefully.
  return {
    ...base,
    postType: "external",
    assets: [],
    unsupportedReason: base.domain
      ? `Tipo de contenido no soportado por ahora (dominio: ${base.domain}).`
      : "Tipo de contenido no soportado por ahora.",
  };
}

function extractGalleryAssets(post: RedditPostData): MediaAsset[] {
  const meta = post.media_metadata ?? {};
  const assets: MediaAsset[] = [];
  for (const item of post.gallery_data?.items ?? []) {
    const m = meta[item.media_id];
    if (!m || m.status === "failed") continue;
    const s = m.s;
    const isAnimated = m.e === "AnimatedImage";
    const url = isAnimated ? (s?.mp4 ?? s?.gif ?? s?.u) : s?.u;
    if (!isHttpUrl(url)) continue;
    assets.push({ url, width: s?.x, height: s?.y, mimeType: m.m, isAnimated });
  }
  return assets;
}

function directUrl(post: RedditPostData): string | undefined {
  const candidate = post.url_overridden_by_dest ?? post.url;
  return isHttpUrl(candidate) ? candidate : undefined;
}

function hostnameOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function isHttpUrl(value?: string): value is string {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
