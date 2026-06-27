/**
 * Drizzle schema. The only table is an ANONYMOUS download-events log.
 *
 * IMPORTANT: this table must never contain anything that identifies who
 * requested a download — no IP, no session, no user id, no request headers.
 * Only aggregate, content-derived facts about the media itself.
 */
import {
  bigint,
  boolean,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const postTypeEnum = pgEnum("post_type", [
  "image",
  "video",
  "gallery",
  "external",
]);

export const downloadStatusEnum = pgEnum("download_status", [
  "success",
  "failed",
]);

export const downloadEvents = pgTable("download_events", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  subreddit: text("subreddit").notNull(),
  postType: postTypeEnum("post_type").notNull(),
  domain: text("domain").notNull(),
  isNsfw: boolean("is_nsfw").notNull(),
  hasAudio: boolean("has_audio").notNull(),
  mediaCount: integer("media_count").notNull(),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
  durationSeconds: integer("duration_seconds"),
  redditScore: integer("reddit_score"),
  status: downloadStatusEnum("status").notNull(),
  processingMs: integer("processing_ms").notNull(),
});

export type NewDownloadEvent = typeof downloadEvents.$inferInsert;
export type DownloadEvent = typeof downloadEvents.$inferSelect;
