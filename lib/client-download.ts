/**
 * Client-side helpers to trigger downloads.
 *
 * Downloads reference server-held job state by id (jobId + itemId), NOT raw
 * media URLs — the server reads the URL from its own state and re-validates the
 * host, so these endpoints can't be abused as an open proxy (SSRF). The actual
 * route handlers are implemented in phase 4.
 */

export function triggerDownload(href: string, downloadName?: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  if (downloadName) a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Pull the filename out of a `Content-Disposition` header (prefers RFC 5987 `filename*`). */
function filenameFromDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const star = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* fall through to plain filename */
    }
  }
  const plain = header.match(/filename="([^"]+)"/i);
  return plain?.[1];
}

/**
 * Fetch a download endpoint as a blob and save it, resolving only once the
 * server has finished producing the file. Unlike a bare anchor click this gives
 * the caller a promise to drive a loading state, while preserving the server's
 * `Content-Disposition` filename.
 */
export async function downloadFile(url: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("El servidor no pudo generar la descarga.");

  const name = filenameFromDisposition(res.headers.get("content-disposition"));
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  try {
    triggerDownload(href, name);
  } finally {
    URL.revokeObjectURL(href);
  }
}

/** GET endpoint for a single image / gallery asset (index defaults to 0). */
export function mediaDownloadUrl(jobId: string, itemId: string, index = 0): string {
  const params = new URLSearchParams({ job: jobId, item: itemId, i: String(index) });
  return `/api/download/media?${params.toString()}`;
}

/** GET endpoint for a merged (video+audio) v.redd.it download. */
export function videoDownloadUrl(jobId: string, itemId: string): string {
  const params = new URLSearchParams({ job: jobId, item: itemId });
  return `/api/download/video?${params.toString()}`;
}

/** POST a set of items (or a single gallery) to be streamed back as a ZIP. */
export async function downloadZip(jobId: string, itemIds: string[]): Promise<void> {
  const res = await fetch("/api/download/zip", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId, itemIds }),
  });
  if (!res.ok) throw new Error("El servidor no pudo generar el ZIP.");

  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  try {
    triggerDownload(href, "reddit-downloads.zip");
  } finally {
    URL.revokeObjectURL(href);
  }
}
