"use client";

import { useMemo, useState } from "react";
import { ClipboardIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { detectRedditUrls } from "@/lib/reddit/url";

interface UrlInputProps {
  onSubmit: (text: string) => void;
  isPending: boolean;
}

export function UrlInput({ onSubmit, isPending }: UrlInputProps) {
  const [text, setText] = useState("");
  const detected = useMemo(() => detectRedditUrls(text), [text]);
  const canSubmit = detected.length > 0 && !isPending;

  async function pasteFromClipboard() {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) {
        toast.info("El portapapeles está vacío.");
        return;
      }
      setText((prev) => (prev.trim() ? `${prev}\n${clip}` : clip));
    } catch {
      toast.error("No se pudo leer el portapapeles.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Pegá una o varias URLs de Reddit (posts, galerías, videos, links cortos redd.it/… o de compartir /s/…)"
        rows={4}
        className="resize-none text-base"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSubmit) {
            onSubmit(text);
          }
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {detected.length === 0
            ? "Ninguna URL de Reddit detectada todavía."
            : `${detected.length} ${detected.length === 1 ? "URL detectada" : "URLs detectadas"}`}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={pasteFromClipboard}
            className="transition-transform active:scale-[0.97]"
          >
            <ClipboardIcon />
            Pegar
          </Button>
          <Button
            onClick={() => onSubmit(text)}
            disabled={!canSubmit}
            className="transition-transform active:scale-[0.97]"
          >
            {isPending ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
            Extraer
          </Button>
        </div>
      </div>
    </div>
  );
}
