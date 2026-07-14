CREATE TYPE "public"."download_status" AS ENUM('success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."post_type" AS ENUM('image', 'video', 'gallery', 'external');--> statement-breakpoint
CREATE TABLE "download_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subreddit" text NOT NULL,
	"post_type" "post_type" NOT NULL,
	"domain" text NOT NULL,
	"is_nsfw" boolean NOT NULL,
	"has_audio" boolean NOT NULL,
	"media_count" integer NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"duration_seconds" integer,
	"reddit_score" integer,
	"status" "download_status" NOT NULL,
	"processing_ms" integer NOT NULL
);
