"use client";

import { useState } from "react";
import { DownloadIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { downloadZip } from "@/lib/client-download";
import type { Job } from "@/lib/job-types";

/** Streams a ZIP of every ready, downloadable item. Hidden unless 2+ qualify. */
export function DownloadAllButton({ job }: { job: Job }) {
  const [busy, setBusy] = useState(false);

  const downloadable = job.items.filter(
    (i) => i.status === "ready" && i.post && i.post.postType !== "external",
  );
  if (downloadable.length < 2) return null;

  async function handleClick() {
    setBusy(true);
    try {
      await downloadZip(
        job.id,
        downloadable.map((i) => i.id),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo armar el ZIP.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="outline"
      onClick={handleClick}
      disabled={busy}
      className="transition-transform active:scale-[0.97]"
    >
      {busy ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
      Descargar todo ({downloadable.length})
    </Button>
  );
}
