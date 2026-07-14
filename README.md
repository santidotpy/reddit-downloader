# reddit-downloader

Pegás una o varias URLs de Reddit y la app extrae el contenido multimedia
(imágenes, galerías y videos con audio) y te lo deja descargar.

Es una **única app de Next.js** (App Router): el "backend" son Route Handlers,
no hay servicio aparte.

---

## Features

- **Input central** que detecta **todas** las URLs de Reddit pegadas en un
  texto (regex) + botón "pegar del portapapeles".
- **Extracción vía `gallery-dl`**, que resuelve links cortos / de compartir
  (`redd.it/xxx`, `reddit.com/r/.../s/xxx`) y devuelve la metadata del post.
- **Clasificación** de cada post: `image` · `gallery` · `video` · `external`
  (estos últimos se marcan como no soportados, sin romper).
- **Imágenes y galerías** vía `gallery-dl`; **videos** vía `yt-dlp`
  (merge de video+audio de `v.redd.it` con `ffmpeg`).
- **Cola de concurrencia limitada** (p-queue, 3) con estado **por ítem** en
  tiempo real vía **SSE** (en cola → procesando → listo/falló).
- **Descargas servidas por el servidor** (proxy con `Content-Disposition` y
  nombre saneado), **nunca** link directo al CDN. Streaming, sin bufferear.
- **ZIP en streaming** (archiver) para galerías y para "descargar todo".
- **NSFW**: preview difuminada con botón "mostrar".
- **Logging anónimo** de cada descarga en Postgres (Neon + Drizzle). Nunca se
  guarda IP, sesión ni nada que identifique a quién descargó.

---

## Stack

- **Next.js 16** (App Router, Route Handlers, output `standalone`)
- **React 19**, **TypeScript** estricto
- **shadcn/ui** sobre **Base UI**, **Tailwind v4**
- **TanStack Query** (request de extracción + suscripción al SSE)
- **zod** (validación), **p-queue** (cola)
- **gallery-dl** (extracción) + **yt-dlp** / **ffmpeg** (video)
- **archiver** (ZIP), **Neon serverless** + **Drizzle ORM**
- **pnpm**

---

## Estructura

```
app/
  page.tsx                     # UI (server shell -> <Downloader/>)
  api/
    extract/route.ts           # POST: detecta URLs, crea job, encola
    jobs/[id]/route.ts         # GET (SSE): estado por ítem
    download/media/route.ts    # GET: proxy de imagen/galería
    download/video/route.ts    # GET: yt-dlp -> stream -> cleanup
    download/zip/route.ts      # POST: ZIP en streaming
lib/
  gallerydl.ts                 # adapter de gallery-dl: el ÚNICO módulo que lo conoce
  reddit/                      # url (detección + allowlist de hosts), types, errors
  reddit-cookies.ts            # parseo/inyección in-memory de cookies de sesión
  queue.ts                     # p-queue + store de jobs en memoria + SSE emitter
  job-types.ts                 # tipos serializables compartidos server/client
  ytdlp.ts                     # wrapper de yt-dlp + ffmpeg (solo video)
  download-cache.ts            # cache de assets ya resueltos por job
  filename.ts                  # saneo de nombres + Content-Disposition
  client-download.ts           # helpers de descarga (cliente)
  db/                          # schema, cliente Neon/Drizzle, logEvent anónimo
components/                    # downloader, url-input, media-grid, media-card, nsfw-blur, ...
drizzle/                       # migraciones generadas
Dockerfile                     # imagen de prod (ffmpeg + yt-dlp del sistema)
```

---

## Setup

Requisitos: **Node 22+**, **pnpm**, y **`gallery-dl`** (obligatorio: es el único
camino de extracción — sin él, *todos* los jobs fallan). Para videos, además:
**yt-dlp** y **ffmpeg**.

```bash
brew install gallery-dl yt-dlp ffmpeg    # macOS (o pipx install gallery-dl)

pnpm install
cp .env.example .env.local               # y completá las variables (abajo)
pnpm dev                                 # http://localhost:3000
```

> Después de editar `.env.local` hay que **reiniciar** `pnpm dev` (las env vars
> no se recargan en caliente).

### Variables de entorno

Ninguna es estrictamente obligatoria, pero **sin alguna forma de auth de Reddit
la extracción probablemente falle** (ver abajo).

| Variable | Para qué |
| --- | --- |
| `GALLERY_DL_COOKIES_FROM_BROWSER` | Auth vía cookies del navegador (`chrome`, `firefox`, …). Lo más simple en local. No sirve en Docker. |
| `GALLERY_DL_COOKIES` | Auth vía `cookies.txt` exportado (formato Netscape). Sirve en Docker. |
| `REDDIT_REFRESH_TOKEN` | Auth vía OAuth. Recomendado para deploy: no vence como la cookie. |
| `REDDIT_CLIENT_ID` | Sólo si el refresh-token salió de **tu propia** app de Reddit (ver abajo). |
| `GALLERY_DL_PATH` / `GALLERY_DL_CONFIG` | Ruta del binario / config explícita, si no están en el `PATH`. |
| `YT_DLP_PATH` / `FFMPEG_PATH` | Ídem, para el download de video. |
| `DATABASE_URL` | Postgres (Neon) para el logging anónimo. Opcional. |

### Auth de Reddit (necesario en la práctica)

Reddit tiene un **WAF anti-bot** que bloquea IPs de datacenter y clientes que no
reconoce (*"blocked by network security"*). Hay que decirle a `gallery-dl` quién
es. Elegí **una**:

**A) Cookies del navegador** — lo más simple para uso local/personal. Usa tu
sesión de Reddit ya logueada:

```env
GALLERY_DL_COOKIES_FROM_BROWSER="chrome"
```

**B) `cookies.txt` exportado** — la única opción con cookies que anda en Docker
(el contenedor no tiene navegador). Exportalo en formato Netscape y montalo como
secret/volumen:

```env
GALLERY_DL_COOKIES="/ruta/afuera/del/repo/cookies.txt"
```

> ⚠️ Ese archivo **es tu sesión de Reddit**. Tratalo como una contraseña,
> guardalo **fuera del repo** y no lo commitees nunca. Además `token_v2` vence
> ~a diario, así que hay que re-exportarlo seguido: sirve para probar, no es
> ideal para algo que quede corriendo solo.

**C) OAuth refresh-token** — **recomendado para un deploy real**, porque no vence
como la cookie:

```bash
gallery-dl oauth:reddit     # te da el refresh token
```

```env
REDDIT_REFRESH_TOKEN="..."
```

> Si el token salió de `gallery-dl oauth:reddit` (que usa el client-id propio de
> gallery-dl), **dejá `REDDIT_CLIENT_ID` vacío**: un client-id que no coincide
> hace fallar el OAuth con `AuthenticationError`. Seteá los dos juntos sólo si
> el refresh-token salió de una app registrada por vos.

La app también acepta **cookies pegadas a mano por request** desde la UI (o vía
el bookmarklet). Se inyectan sólo en memoria — nunca tocan el disco.

### Base de datos (opcional)

Sólo hace falta si querés el logging anónimo de descargas. Sin `DATABASE_URL`, el
logging es no-op y la app funciona igual.

```bash
# con DATABASE_URL seteada (Neon)
pnpm db:generate   # genera migración desde el schema (ya hay una en drizzle/)
pnpm db:migrate    # aplica migraciones
pnpm db:push       # alternativa: push directo del schema
pnpm db:studio     # explorar la DB
```

Tabla `download_events` (anónima): `subreddit`, `post_type`, `domain`,
`is_nsfw`, `has_audio`, `media_count`, `file_size_bytes`, `duration_seconds`,
`reddit_score`, `status`, `processing_ms`, `created_at`. **No** hay IP ni sesión.

---

## Uso

1. Pegá texto con una o más URLs de Reddit (o usá "Pegar").
2. "Extraer": cada URL entra a la cola; las tarjetas muestran el estado en vivo.
3. Descargá por tarjeta, o "Descargar todo" (ZIP) cuando hay 2+ ítems.

---

## Cómo funciona

- **Extracción**: `processRedditUrl` delega en `lib/gallerydl.ts`, que corre
  `gallery-dl -j <url>` (sólo metadata, no baja bytes) y normaliza la salida a un
  `ResolvedPost`. gallery-dl resuelve solo los links cortos / de compartir.
  Es el **único** módulo que sabe que gallery-dl existe: si algún día se cambia
  la herramienta, sólo se toca ese archivo.
- **Cola**: `POST /api/extract` crea un job en memoria y encola cada ítem
  (concurrencia 3). El cliente se suscribe a `GET /api/jobs/[id]` (SSE) y vuelca
  cada snapshot al cache de TanStack Query.
- **Descargas**: referencian `jobId`+`itemId` (no URLs del cliente); el server
  resuelve la URL desde su estado y valida que el host sea CDN de Reddit, así el
  proxy no es un open-SSRF. Todo se streamea; los temporales de video se borran
  siempre al terminar.
- **Estado**: el store de jobs vive en memoria (1 contenedor stateless). La
  única persistencia es el log anónimo en Neon.

---

## Deploy (Docker)

Pensado para un host de contenedores (**Railway**, **Fly**), **no** Vercel
serverless (jobs largos + binarios).

```bash
docker build -t reddit-downloader .
docker run -p 3000:3000 --env-file .env.local reddit-downloader
```

La imagen instala `ffmpeg` por apt, baja el binario standalone de `yt-dlp` (no
necesita Python) e instala `gallery-dl` desde PyPI en un venv aislado en
`/opt/gallery-dl` (gallery-dl **no** publica binario standalone, así que sí
necesita un runtime de Python). Los usa vía `GALLERY_DL_PATH` / `YT_DLP_PATH` /
`FFMPEG_PATH`. El build corre un smoke test de ambos, así que un binario faltante
falla en build y no en runtime. El contenedor es stateless; la DB es Neon
gestionada.

Para la auth de Reddit en Docker, `--cookies-from-browser` **no** sirve (no hay
navegador): usá `REDDIT_REFRESH_TOKEN` (recomendado) o montá un `cookies.txt` y
apuntá `GALLERY_DL_COOKIES` a él.

---

## Limitaciones / Troubleshooting

- **Todos los jobs fallan** → falta el binario `gallery-dl`, o no está en el
  `PATH`. `gallery-dl --version` para chequear; si está en otro lado, seteá
  `GALLERY_DL_PATH`.
- **"Reddit bloqueó el acceso" / WAF** → falta auth. Configurá
  `GALLERY_DL_COOKIES_FROM_BROWSER`, `GALLERY_DL_COOKIES` o
  `REDDIT_REFRESH_TOKEN`, y reiniciá el server. Ver "Auth de Reddit".
- **Videos no descargan en local** → `yt-dlp` (vía youtube-dl-exec) es un zipapp
  de Python que necesita **Python ≥3.10**. En macOS con Python 3.9 falla;
  resolvé con `brew install yt-dlp` (o Python 3.10+). En Docker ya está resuelto.
- **`external`** (links a YouTube, imgur, etc.) se marcan como no soportados a
  propósito.
- El store de jobs es en memoria: con **múltiples réplicas** habría que moverlo a
  un store compartido (hoy fuera de scope).

---

## Scripts

| Script | Qué hace |
| --- | --- |
| `pnpm dev` | dev server |
| `pnpm build` / `pnpm start` | build de prod / servir |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `pnpm format` | eslint / prettier |
| `pnpm db:generate` / `db:migrate` / `db:push` / `db:studio` | Drizzle |
