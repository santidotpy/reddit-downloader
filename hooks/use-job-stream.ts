"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Job } from "@/lib/job-types";

export function jobQueryKey(jobId: string | null) {
  return ["job", jobId] as const;
}

/**
 * Subscribe to a job's SSE stream and mirror each snapshot into the TanStack
 * Query cache. The query itself never fetches (`enabled: false`) — data is
 * pushed by the EventSource. Components read the job via this hook's return or
 * via `useQuery(jobQueryKey(id))`.
 */
export function useJobStream(jobId: string | null): Job | null {
  const queryClient = useQueryClient();

  const { data } = useQuery<Job | null>({
    queryKey: jobQueryKey(jobId),
    queryFn: () => null, // data arrives via SSE, never fetched
    enabled: false,
    initialData: null,
  });

  useEffect(() => {
    if (!jobId) return;

    const source = new EventSource(`/api/jobs/${jobId}`);

    const onUpdate = (event: MessageEvent<string>) => {
      try {
        queryClient.setQueryData<Job>(jobQueryKey(jobId), JSON.parse(event.data));
      } catch {
        // ignore malformed frame
      }
    };

    source.addEventListener("update", onUpdate);
    source.addEventListener("done", () => source.close());
    source.onerror = () => source.close();

    return () => source.close();
  }, [jobId, queryClient]);

  return data ?? null;
}
