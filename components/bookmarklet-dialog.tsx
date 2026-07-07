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
    alert('Abrí reddit.com con tu sesión iniciada y hacé clic en el bookmarklet ahí.');return;
  }
  var jar=document.cookie.split(';').map(function(c){return c.trim();}).filter(function(c){
    return allow.indexOf(c.split('=')[0])>-1;
  });
  if(!jar.length){alert('No se encontraron cookies de Reddit. ¿Iniciaste sesión?');return;}
  var out=jar.join('; ');
  function ok(){alert('Cookies de Reddit copiadas ('+jar.length+'). Volvé a la app y pegalas.');}
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(out).then(ok,function(){prompt('Copiá manualmente:',out);});
  }else{prompt('Copiá manualmente:',out);}
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
        Autocompletar desde el navegador
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Autocompletar desde el navegador</DialogTitle>
          <DialogDescription>
            Por seguridad, un sitio no puede leer las cookies de reddit.com por vos. Este
            marcador (bookmarklet) lo hace desde tu propia sesión de Reddit y las copia al
            portapapeles para que las pegues acá.
          </DialogDescription>
        </DialogHeader>

        {/* Warning: exactly what it does, before they install/run it. */}
        <div className="flex gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            Este bookmarklet lee los valores de cookies de tu sesión actual en reddit.com y
            los copia a tu portapapeles. No se envía nada a ningún servidor salvo lo que vos
            mismo pegues acá.
          </p>
        </div>

        <ol className="flex flex-col gap-2 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">1.</span> Arrastrá este botón a tu
            barra de marcadores:
            <div className="mt-2">
              <a
                ref={setBookmarkletHref}
                onClick={(e) => e.preventDefault()}
                draggable
                title="Arrastrame a la barra de marcadores"
                className="inline-flex cursor-grab items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1.5 text-sm font-medium text-foreground shadow-xs active:cursor-grabbing"
              >
                <BookmarkIcon className="size-4" />
                Cookies de Reddit → App
              </a>
            </div>
          </li>
          <li>
            <span className="font-medium text-foreground">2.</span> Abrí{" "}
            <a
              href="https://www.reddit.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              reddit.com
            </a>{" "}
            con tu sesión iniciada.
          </li>
          <li>
            <span className="font-medium text-foreground">3.</span> Hacé clic en el marcador
            que acabás de crear. Copiará las cookies al portapapeles.
          </li>
          <li>
            <span className="font-medium text-foreground">4.</span> Volvé acá y pegalas en el
            campo de cookies.
          </li>
        </ol>

        <p className="text-xs text-muted-foreground">
          Nota: el navegador oculta las cookies más sensibles (<code>reddit_session</code>,{" "}
          <code>token_v2</code>) del bookmarklet. Alcanzan para contenido público; para
          contenido NSFW/privado, pegá manualmente esas cookies desde DevTools.
        </p>
      </DialogContent>
    </Dialog>
  );
}
