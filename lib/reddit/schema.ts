/**
 * Zod schemas for the subset of Reddit's post .json we actually consume.
 *
 * Reddit's payload is huge and noisy, so every field is optional and objects
 * `.passthrough()` unknown keys. We validate *shape*, not completeness — the
 * goal is to fail loudly only when the response isn't a post listing at all.
 */
import { z } from "zod";

const mediaMetadataItemSchema = z
  .object({
    status: z.string().optional(), // "valid" | "failed"
    e: z.string().optional(), // "Image" | "AnimatedImage"
    m: z.string().optional(), // mime type, e.g. "image/jpg"
    s: z
      .object({
        u: z.string().optional(), // still source URL
        gif: z.string().optional(),
        mp4: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const redditVideoSchema = z
  .object({
    fallback_url: z.string().optional(),
    dash_url: z.string().optional(),
    hls_url: z.string().optional(),
    duration: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    has_audio: z.boolean().optional(),
  })
  .passthrough();

export const redditPostDataSchema = z
  .object({
    id: z.string().optional(),
    subreddit: z.string().optional(),
    title: z.string().optional(),
    over_18: z.boolean().optional(),
    score: z.number().optional(),
    post_hint: z.string().optional(),
    domain: z.string().optional(),
    url: z.string().optional(),
    url_overridden_by_dest: z.string().optional(),
    permalink: z.string().optional(),
    thumbnail: z.string().optional(),
    is_gallery: z.boolean().optional(),
    is_video: z.boolean().optional(),
    gallery_data: z
      .object({
        items: z.array(
          z
            .object({ media_id: z.string(), id: z.number().optional() })
            .passthrough(),
        ),
      })
      .nullish(),
    media_metadata: z.record(z.string(), mediaMetadataItemSchema).nullish(),
    media: z.object({ reddit_video: redditVideoSchema.optional() }).nullish(),
    secure_media: z
      .object({ reddit_video: redditVideoSchema.optional() })
      .nullish(),
  })
  .passthrough();

const listingSchema = z.object({
  data: z.object({
    children: z.array(
      z.object({
        kind: z.string().optional(),
        data: redditPostDataSchema,
      }),
    ),
  }),
});

/** A permalink `.json` returns `[postListing, commentsListing]`. */
export const listingResponseSchema = z.array(listingSchema).min(1);

export type RedditPostData = z.infer<typeof redditPostDataSchema>;
