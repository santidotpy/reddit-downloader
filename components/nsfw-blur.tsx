"use client";

import { useState } from "react";
import { EyeIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Blurs its children (a media preview) until the user opts to reveal it.
 * `scale-105` hides the transparent edges that a heavy blur would expose.
 */
export function NsfwBlur({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="absolute inset-0">
      <div
        className={cn(
          "h-full w-full transition-[filter,transform] duration-200",
          !revealed && "scale-105 blur-xl",
        )}
      >
        {children}
      </div>
      {!revealed && (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/30 text-foreground backdrop-blur-[2px] transition-transform active:scale-[0.98]"
        >
          <EyeIcon className="size-5" />
          <span className="text-xs font-medium">Show (NSFW)</span>
        </button>
      )}
    </div>
  );
}
