"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UrlInput } from "@/components/url-input";
import { MediaGrid } from "@/components/media-grid";
import { DownloadAllButton } from "@/components/download-all-button";
import { Progress } from "@/components/ui/progress";
import { jobQueryKey, useJobStream } from "@/hooks/use-job-stream";
import type { Job } from "@/lib/job-types";

interface ExtractResponse {
  jobId: string;
  truncated: boolean;
  items: Job["items"];
}

async function postExtract(text: string): Promise<ExtractResponse> {
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : "No se pudo procesar el texto.";
    throw new Error(message);
  }
  return data as ExtractResponse;
}

export function Downloader() {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJobStream(jobId);

  const mutation = useMutation({
    mutationFn: postExtract,
    onSuccess: (data) => {
      // Seed the cache so queued cards render before the first SSE frame.
      queryClient.setQueryData<Job>(jobQueryKey(data.jobId), {
        id: data.jobId,
        createdAt: Date.now(),
        items: data.items,
      });
      setJobId(data.jobId);
      if (data.truncated) {
        toast.warning("Se procesan solo las primeras 25 URLs.");
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Error inesperado.");
    },
  });

  return (
    <div className="flex flex-col gap-8">
      <UrlInput
        onSubmit={(text) => mutation.mutate(text)}
        isPending={mutation.isPending}
      />

      {job && job.items.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ProgressSummary job={job} />
            <DownloadAllButton job={job} />
          </div>
          <MediaGrid items={job.items} jobId={job.id} />
        </section>
      )}
    </div>
  );
}

function ProgressSummary({ job }: { job: Job }) {
  const total = job.items.length;
  const settled = job.items.filter(
    (i) => i.status === "ready" || i.status === "failed",
  ).length;
  const failed = job.items.filter((i) => i.status === "failed").length;
  const done = settled === total;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">
        {done
          ? failed > 0
            ? `Listo · ${total - failed}/${total} ok, ${failed} con error`
            : `Listo · ${total}/${total}`
          : `Procesando ${settled}/${total}…`}
      </p>
      <Progress value={(settled / total) * 100} className="h-1.5 w-40" />
    </div>
  );
}
