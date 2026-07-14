"use client";

import { BookmarkIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * The bookmarklet source. Runs in the context of reddit.com when the user clicks
 * it from their bookmarks bar. It can only read NON-HttpOnly cookies (browsers
 * hide `reddit_session` / `token_v2` from `document.cookie`), which is enough to
 * clear Reddit's WAF for public content. It never sends anything anywhere — it
 * only copies a `name=value; …` string to the clipboard for the user to paste.
 */
const BOOKMARKLET_SOURCE = `(function(){
  var allow=['reddit_session','token_v2','loid','edgebucket','session_tracker','csv','pc'];
  if(!/(^|\\.)reddit\\.com$/.test(location.hostname)){
    alert('Open reddit.com while logged in, then click the bookmarklet there.');return;
  }
  var jar=document.cookie.split(';').map(function(c){return c.trim();}).filter(function(c){
    return allow.indexOf(c.split('=')[0])>-1;
  });
  if(!jar.length){alert('No Reddit cookies found. Are you logged in?');return;}
  var out=jar.join('; ');
  function ok(){alert('Copied '+jar.length+' Reddit cookies. Go back to the app and paste them.');}
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(out).then(ok,function(){prompt('Copy manually:',out);});
  }else{prompt('Copy manually:',out);}
})();`;

// Collapse whitespace and prefix with the javascript: scheme.
const BOOKMARKLET_HREF =
  "javascript:" + encodeURIComponent(BOOKMARKLET_SOURCE.replace(/\s*\n\s*/g, ""));

// React strips `javascript:` hrefs, and the drag anchor only mounts when the
// dialog opens (it's portaled), so a callback ref sets the real href on mount.
function setBookmarkletHref(node: HTMLAnchorElement | null) {
  node?.setAttribute("href", BOOKMARKLET_HREF);
}

export function BookmarkletDialog() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="transition-transform active:scale-[0.97]"
          />
        }
      >
        <BookmarkIcon />
        Autofill from browser
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Autofill from browser</DialogTitle>
          <DialogDescription>
            For security reasons, a website can&apos;t read reddit.com&apos;s cookies on your
            behalf. This bookmarklet does it from your own Reddit session and copies them to
            your clipboard so you can paste them here.
          </DialogDescription>
        </DialogHeader>

        {/* Warning: exactly what it does, before they install/run it. */}
        <div className="flex gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            This bookmarklet reads the cookie values from your current reddit.com session and
            copies them to your clipboard. Nothing is sent to any server except what you
            paste here yourself.
          </p>
        </div>

        <ol className="flex flex-col gap-2 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">1.</span> Drag this button to your
            bookmarks bar:
            <div className="mt-2">
              <a
                ref={setBookmarkletHref}
                onClick={(e) => e.preventDefault()}
                draggable
                title="Drag me to your bookmarks bar"
                className="inline-flex cursor-grab items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1.5 text-sm font-medium text-foreground shadow-xs active:cursor-grabbing"
              >
                <BookmarkIcon className="size-4" />
                Reddit cookies → App
              </a>
            </div>
          </li>
          <li>
            <span className="font-medium text-foreground">2.</span> Open{" "}
            <a
              href="https://www.reddit.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              reddit.com
            </a>{" "}
            while logged in.
          </li>
          <li>
            <span className="font-medium text-foreground">3.</span> Click the bookmark you
            just created. It copies the cookies to your clipboard.
          </li>
          <li>
            <span className="font-medium text-foreground">4.</span> Come back here and paste
            them into the cookies field.
          </li>
        </ol>

        <p className="text-xs text-muted-foreground">
          Note: your browser hides the most sensitive cookies (<code>reddit_session</code>,{" "}
          <code>token_v2</code>) from the bookmarklet. They&apos;re enough for public content;
          for NSFW/private content, paste those cookies manually from DevTools.
        </p>
      </DialogContent>
    </Dialog>
  );
}
