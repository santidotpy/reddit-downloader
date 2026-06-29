# Deploy TODO — gallery-dl migration

Estado: la migración a **gallery-dl** está funcionalmente completa y probada en
local (rama `feature/gallery-dl`). Falta lo necesario para **producción (Docker)**.
Local anda con `GALLERY_DL_COOKIES` apuntando a un `cookies.txt` exportado del
navegador. Estos puntos son para cuando vayamos a deployar.

## 1. Dockerfile: instalar gallery-dl
- [ ] Confirmar que la imagen instale el binario de **gallery-dl** (además de
      `yt-dlp` + `ffmpeg` que ya estaban).
- Opción simple: binario standalone (PyInstaller) en el `PATH`, o `pip install gallery-dl`.
- Si va a una ruta no estándar, setear `GALLERY_DL_PATH` con la ruta del binario.
- yt-dlp se mantiene para videos `v.redd.it` (merge DASH+audio).

## 2. Auth de Reddit en el server (sin navegador)
`--cookies-from-browser` NO sirve en Docker (no hay navegador). Elegir uno:

- [ ] **Opción A — cookies.txt** (`GALLERY_DL_COOKIES=/ruta/cookies.txt`)
  - Exportar el `cookies.txt` (formato Netscape) e incluirlo como secret/volumen.
  - Contra: `token_v2` vence ~diario → el archivo se pone viejo y hay que re-exportar seguido. Sirve para probar, no ideal para algo que quede solo.
- [ ] **Opción B — OAuth refresh-token (recomendado para durar)**
  - `REDDIT_REFRESH_TOKEN` (+ `REDDIT_USER_AGENT` si hace falta). No expira como el token de cookie.
  - Si el refresh-token salió de `gallery-dl oauth:reddit` (client-id propio de gallery-dl), **NO** setear `REDDIT_CLIENT_ID` (mismatch → AuthenticationError). Solo setear ambos si el token salió de una app instalada propia.

> El adapter (`lib/gallerydl.ts` → `authArgs`) ya lee todas estas env vars:
> `GALLERY_DL_PATH`, `GALLERY_DL_CONFIG`, `GALLERY_DL_COOKIES`,
> `GALLERY_DL_COOKIES_FROM_BROWSER`, `REDDIT_REFRESH_TOKEN`, `REDDIT_CLIENT_ID`.
> No hace falta tocar código, solo configurar el entorno del deploy.

## 3. Limpieza de código viejo (opcional)
Quedó fuera del hot path tras la migración; borrar cuando estemos seguros de no
volver atrás:
- [ ] `lib/reddit/fetch-json.ts`
- [ ] `lib/reddit/classify.ts`
- [ ] `lib/reddit/auth.ts`
- [ ] `lib/reddit/schema.ts`
- [ ] `resolveRedditUrl` en `lib/reddit/url.ts` (mantener `detectRedditUrls`, `isRedditHost`, `isRedditMediaHost`)
- [ ] Revisar `REDDIT_CLIENT_ID/SECRET` en `.env.local` (eran para el pipeline viejo; ya no se usan salvo OAuth de gallery-dl).

## 4. Polish opcional
- [ ] Clasificación redgifs: hoy entra como `image` (un mp4 directo). La descarga
      anda y el preview usa el thumbnail de Reddit, pero la tarjeta no muestra el
      overlay de "play". Si se quiere, marcar el asset como video sin romper el
      ruteo de descarga (gallery-dl, NO yt-dlp).

## 5. Sin commitear todavía (al cerrar la sesión local)
- `components/media-card.tsx`, `drizzle.config.ts`, `lib/gallerydl.ts`
- (los secrets `reddit-cookies.txt` y `.env.local` están gitignoreados — no subir)
