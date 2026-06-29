# reddit-downloader

Pegás una o varias URLs de Reddit y la app extrae el contenido multimedia
(imágenes, galerías y videos con audio) y te lo deja descargar.

Es una **única app de Next.js** (App Router): el "backend" son Route Handlers,
no hay servicio aparte.

---

## Features

- **Input central** que detecta **todas** las URLs de Reddit pegadas en un
  texto (regex) + botón "pegar del portapapeles".
- **Resolución de links cortos / de compartir** (`redd.it/xxx`,
  `reddit.com/r/.../s/xxx`) siguiendo redirects hasta el permalink canónico,
  validando en cada salto que el host siga siendo de Reddit (anti-SSRF).
- **Clasificación** de cada post: `image` · `gallery` · `video` · `external`
  (estos últimos se marcan como no soportados, sin romper).
- **Imágenes y galerías** vía la API JSON de Reddit; **videos** vía `yt-dlp`
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
- **youtube-dl-exec** (yt-dlp) + **ffmpeg** / **ffmpeg-static**
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
  reddit/                      # url, auth (OAuth), fetch-json, classify, schema, types
  queue.ts                     # p-queue + store de jobs en memoria + SSE emitter
  job-types.ts                 # tipos serializables compartidos server/client
  ytdlp.ts                     # wrapper de yt-dlp + ffmpeg
  filename.ts                  # saneo de nombres + Content-Disposition
  client-download.ts           # helpers de descarga (cliente)
  db/                          # schema, cliente Neon/Drizzle, logEvent anónimo
components/                    # downloader, url-input, media-grid, media-card, nsfw-blur, ...
drizzle/                       # migraciones generadas
Dockerfile                     # imagen de prod (ffmpeg + yt-dlp del sistema)
```

---

## Setup

Requisitos: **Node 22+**, **pnpm**. Para descargar videos en local: **ffmpeg** y
**yt-dlp** (ver "Limitaciones").

```bash
pnpm install
cp .env.example .env.local      # y completá las variables (abajo)
pnpm dev                        # http://localhost:3000
```

> Después de editar `.env.local` hay que **reiniciar** `pnpm dev` (las env vars
> no se recargan en caliente).

### Variables de entorno

| Variable | Requerida | Para qué |
| --- | --- | --- |
| `REDDIT_CLIENT_ID` | sí (ver abajo) | OAuth app-only |
| `REDDIT_CLIENT_SECRET` | sí (ver abajo) | OAuth app-only |
| `REDDIT_USER_AGENT` | recomendada | UA descriptivo enviado a Reddit |
| `DATABASE_URL` | opcional | Postgres (Neon) para el logging anónimo |

### Reddit OAuth (necesario)

Reddit responde **403** al endpoint `.json` **no autenticado** (incluso desde IP
residencial y con cualquier User-Agent). Por eso la app usa **OAuth app-only**:

1. Entrá a <https://www.reddit.com/prefs/apps> → **create another app…**
2. Tipo **`script`**, `redirect uri` = `http://localhost:3000` (obligatorio,
   no se usa).
3. Copiá el **client id** (la cadena debajo del nombre de la app) y el
   **secret** a `.env.local`:
   ```env
   REDDIT_CLIENT_ID="..."
   REDDIT_CLIENT_SECRET="..."
   REDDIT_USER_AGENT="web:reddit-downloader:v0.1 (by /u/TU_USUARIO)"
   ```
4. Reiniciá `pnpm dev`.

Con credenciales, los requests van a `oauth.reddit.com` con bearer token (sin el
bloqueo del `.json` público). Sin credenciales, la app intenta el modo no
autenticado (probablemente 403).

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

- **Extracción**: `resolveRedditUrl` sigue redirects (revalidando host Reddit) →
  `fetchPostJson` (OAuth) → `classifyPost` produce un `ResolvedPost`.
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

La imagen instala `ffmpeg` por apt y baja el binario standalone de `yt-dlp`
(no necesita Python), y los usa vía `FFMPEG_PATH` / `YT_DLP_PATH`. El contenedor
es stateless; la DB es Neon gestionada.

---

## Limitaciones / Troubleshooting

- **403 "Acceso denegado por Reddit"** → falta configurar OAuth
  (`REDDIT_CLIENT_ID`/`SECRET`) y reiniciar el server. Ver "Reddit OAuth".
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
