"use client";

import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronDownIcon, ShieldCheckIcon } from "lucide-react";
import { BookmarkletDialog } from "@/components/bookmarklet-dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface RedditAuthProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Optional Reddit auth section. A convenience layer on top of the server-side
 * cookie levers (`GALLERY_DL_COOKIES` / `…_FROM_BROWSER`, which still work
 * exactly as before): the user can paste a cookie string, or use the bookmarklet
 * to grab one. Whatever is pasted here is sent with the next extraction only,
 * held in server memory for that job, and never written to disk, a DB, or a log.
 */
export function RedditAuth({ value, onChange }: RedditAuthProps) {
  return (
    <Collapsible.Root className="rounded-lg border border-border bg-card/40">
      <Collapsible.Trigger
        className={cn(
          "group flex w-full items-center justify-between gap-2 rounded-lg px-4 py-3",
          "text-sm font-medium outline-none transition-colors hover:bg-muted/50",
          "focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <span className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4 text-muted-foreground" />
          Reddit authentication (optional)
        </span>
        <ChevronDownIcon
          className="size-4 text-muted-foreground transition-transform duration-200 ease-out group-data-[panel-open]:rotate-180"
        />
      </Collapsible.Trigger>

      <Collapsible.Panel
        className={cn(
          "h-[var(--collapsible-panel-height)] overflow-hidden",
          "transition-[height] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
          "data-[closed]:h-0 motion-reduce:transition-none",
        )}
      >
        <div className="flex flex-col gap-3 px-4 pt-1 pb-4">
          <p className="text-sm text-muted-foreground">
            If Reddit is blocking downloads, paste the cookies from a logged-in session here.
            This is an alternative to configuring{" "}
            <code className="text-xs">GALLERY_DL_COOKIES</code> on the server, which still
            works the same way.
          </p>

          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="reddit_session=…; token_v2=…; loid=…"
            rows={3}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            className="resize-none font-mono text-xs"
            aria-label="Reddit cookies"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-md text-xs text-muted-foreground">
              These cookies are used only for this session and are never saved or stored
              anywhere.
            </p>
            <BookmarkletDialog />
          </div>
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
