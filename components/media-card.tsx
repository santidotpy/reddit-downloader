"use client";

import { useState } from "react";
import {
  CircleXIcon,
  DownloadIcon,
  ImageIcon,
  ImagesIcon,
  LinkIcon,
  Loader2Icon,
  PlayIcon,
  VideoIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { NsfwBlur } from "@/components/nsfw-blur";
import {
  downloadFile,
  downloadZip,
  mediaDownloadUrl,
  videoDownloadUrl,
} from "@/lib/client-download";
import type { JobItem } from "@/lib/job-types";
import type { PostType, ResolvedPost } from "@/lib/reddit/types";

const TYPE_LABEL: Record<PostType, string> = {
  image: "Imagen",
  gallery: "Galería",
  video: "Video",
  external: "No soportado",
};

function TypeIcon({ type, className }: { type: PostType; className?: string }) {
  switch (type) {
    case "image":
      return <ImageIcon className={className} />;
    case "gallery":
      return <ImagesIcon className={className} />;
    case "video":
      return <VideoIcon className={className} />;
    default:
      return <LinkIcon className={className} />;
  }
}

function formatDuration(seconds?: number): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const DISPLAYABLE_IMAGE = /\.(jpe?g|png|gif|webp|bmp|avif)(\?|$)/i;

function previewSrc(post: ResolvedPost): string | undefined {
  if (post.postType === "image" || post.postType === "gallery") {
    const first = post.assets[0]?.url;
    // A direct image renders in <img>; a video asset (e.g. redgifs mp4) does
    // not, so fall back to Reddit's static thumbnail.
    if (first && DISPLAYABLE_IMAGE.test(first)) return first;
    return post.thumbnail;
  }
  if (post.postType === "video") return post.thumbnail;
  return undefined;
}

export function MediaCard({ item, jobId }: { item: JobItem; jobId: string }) {
  return (
    <Card className="flex h-full flex-col gap-0 overflow-hidden py-0">
      <div className="relative bg-muted">
        <AspectRatio ratio={16 / 9}>
          <Preview item={item} />
        </AspectRatio>
      </div>
      <CardContent className="flex flex-1 flex-col gap-2 p-4">
        {item.status === "ready" && item.post ? (
          <ReadyMeta post={item.post} />
        ) : (
          <PendingMeta item={item} />
        )}
      </CardContent>
      <CardFooter className="p-4 pt-0">
        <DownloadButton item={item} jobId={jobId} />
      </CardFooter>
    </Card>
  );
}

function Preview({ item }: { item: JobItem }) {
  const { status, post, error } = item;

  if (status === "queued" || status === "processing") {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Skeleton className="absolute inset-0 rounded-none" />
        <Loader2Icon className="relative size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-4 text-center text-destructive">
        <CircleXIcon className="size-6" />
        <span className="text-xs leading-snug">
          {error?.message ?? "Falló la extracción."}
        </span>
      </div>
    );
  }

  if (!post) return null;

  if (post.postType === "external") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-4 text-center text-muted-foreground">
        <LinkIcon className="size-6" />
        <span className="text-xs leading-snug">
          {post.unsupportedReason ?? "Contenido no soportado."}
        </span>
      </div>
    );
  }

  const src = previewSrc(post);
  const media = src ? (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary Reddit CDN hosts
    <img
      src={src}
      alt={post.title}
      loading="lazy"
      className="h-full w-full object-cover"
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center">
      <TypeIcon type={post.postType} className="size-6 text-muted-foreground" />
    </div>
  );

  const overlays = (
    <>
      {media}
      {post.postType === "video" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/55 p-3 text-white">
            <PlayIcon className="size-6" />
          </span>
        </div>
      )}
      {post.postType === "gallery" && (
        <Badge variant="secondary" className="absolute top-2 right-2 gap-1">
          <ImagesIcon />
          {post.assets.length}
        </Badge>
      )}
    </>
  );

  return post.isNsfw ? <NsfwBlur>{overlays}</NsfwBlur> : overlays;
}

function ReadyMeta({ post }: { post: ResolvedPost }) {
  const duration = post.video ? formatDuration(post.video.durationSeconds) : null;

  return (
    <>
      <p className="line-clamp-2 text-sm leading-snug font-medium" title={post.title}>
        {post.title}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="gap-1">
          <TypeIcon type={post.postType} />
          {TYPE_LABEL[post.postType]}
        </Badge>
        {post.isNsfw && <Badge variant="destructive">NSFW</Badge>}
        {duration && <Badge variant="outline">{duration}</Badge>}
        {post.postType === "gallery" && (
          <Badge variant="outline">{post.assets.length} imágenes</Badge>
        )}
      </div>
      <p className="mt-auto truncate text-xs text-muted-foreground">
        r/{post.subreddit}
      </p>
    </>
  );
}

const STATUS_TEXT: Record<JobItem["status"], string> = {
  queued: "En cola",
  processing: "Procesando…",
  ready: "Listo",
  failed: "Falló",
};

function PendingMeta({ item }: { item: JobItem }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="truncate text-sm font-medium" title={item.rawUrl}>
        {item.rawUrl}
      </p>
      <Badge variant={item.status === "failed" ? "destructive" : "secondary"}>
        {STATUS_TEXT[item.status]}
      </Badge>
    </div>
  );
}

function DownloadButton({ item, jobId }: { item: JobItem; jobId: string }) {
  const [busy, setBusy] = useState(false);
  const post = item.post;
  const ready = item.status === "ready" && !!post && post.postType !== "external";

  async function handleDownload() {
    if (!ready || !post || busy) return;

    setBusy(true);
    try {
      if (post.postType === "gallery") {
        await downloadZip(jobId, [item.id]);
      } else if (post.postType === "video") {
        await downloadFile(videoDownloadUrl(jobId, item.id));
      } else {
        await downloadFile(mediaDownloadUrl(jobId, item.id));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo descargar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      onClick={handleDownload}
      disabled={!ready || busy}
      className="w-full transition-transform active:scale-[0.97]"
    >
      {busy ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
      Descargar
    </Button>
  );
}
