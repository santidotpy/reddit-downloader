"use client";

import { MediaCard } from "@/components/media-card";
import type { JobItem } from "@/lib/job-types";

export function MediaGrid({ items, jobId }: { items: JobItem[]; jobId: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item, index) => (
        <div
          key={item.id}
          className="animate-fade-up"
          // Cap the stagger so large batches don't feel slow (emil-design-eng).
          style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
        >
          <MediaCard item={item} jobId={jobId} />
        </div>
      ))}
    </div>
  );
}
