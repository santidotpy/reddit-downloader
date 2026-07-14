# reddit-downloader

Paste one or more Reddit URLs and the app extracts the media (images, galleries,
and videos with audio) and lets you download it.

It's a **single Next.js app** (App Router): the "backend" is Route Handlers,
there's no separate service.

**[English](#english)** · **[Español](#español)**

---

<a name="english"></a>

# English

## Features

- **One input box** that finds **every** Reddit URL in whatever text you paste
  (regex) + a "paste from clipboard" button.
- **Extraction via `gallery-dl`**, which resolves short/share links
  (`redd.it/xxx`, `reddit.com/r/.../s/xxx`) and returns the post metadata.
- **Classification** per post: `image` · `gallery` · `video` · `external`
  (the last is flagged as unsupported rather than failing).
- **Images and galleries** via `gallery-dl`; **videos** via `yt-dlp`
  (merges `v.redd.it` video+audio with `ffmpeg`).
- **Bounded-concurrency queue** (p-queue, 3) with **per-item** live status over
  **SSE** (queued → processing → ready/failed).
- **Server-proxied downloads** (with `Content-Disposition` and a sanitized
  filename), **never** a direct CDN link. Everything streams, nothing is buffered.
- **Streaming ZIP** (archiver) for galleries and "download all".
- **NSFW**: blurred preview with a reveal button.
- **Anonymous logging** of each download to Postgres (Neon + Drizzle). No IP,
  no session, nothing that identifies who downloaded what.

## Stack

- **Next.js 16** (App Router, Route Handlers, `standalone` output)
- **React 19**, strict **TypeScript**
- **shadcn/ui** on **Base UI**, **Tailwind v4**
- **TanStack Query** (extraction request + SSE subscription)
- **zod** (validation), **p-queue** (queue)
- **gallery-dl** (extraction) + **yt-dlp** / **ffmpeg** (video)
- **archiver** (ZIP), **Neon serverless** + **Drizzle ORM**
- **pnpm**

---

## Getting started (step by step)

### Step 1 — Install the prerequisites

You need **Node 22+**, **pnpm**, and **`gallery-dl`**.

> ⚠️ **`gallery-dl` is mandatory.** It is the only extraction path — without it
> on your `PATH`, _every_ job fails.

`yt-dlp` and `ffmpeg` are only needed if you want to download **videos**; images
and galleries work without them.

```bash
# macOS (Homebrew)
brew install gallery-dl yt-dlp ffmpeg

# Linux / anything with pipx
pipx install gallery-dl
```

Check they're visible:

```bash
gallery-dl --version   # e.g. 1.32.4
yt-dlp --version       # optional (video only)
ffmpeg -version        # optional (video only)
```

### Step 2 — Install dependencies

```bash
pnpm install
```

### Step 3 — Create your env file

```bash
cp .env.example .env.local
```

Every variable is optional, but **without some form of Reddit auth, extraction
will most likely fail** — see Step 4.

### Step 4 — Give Reddit a reason to talk to you

Reddit sits behind an **anti-bot WAF** that blocks datacenter IPs and clients it
doesn't recognize (_"blocked by network security"_). You need to tell `gallery-dl`
who it is. Pick **one** of these:

**Option A — Browser cookies (easiest for local use).**
Reuses your already-logged-in Reddit session:

```env
GALLERY_DL_COOKIES_FROM_BROWSER="chrome"   # or firefox, safari, edge…
```

**Option B — An exported `cookies.txt`.**
The only cookie option that works in Docker (a container has no browser). Export
it in Netscape format and mount it as a secret/volume:

```env
GALLERY_DL_COOKIES="/path/outside/the/repo/cookies.txt"
```

> ⚠️ **That file _is_ your Reddit session.** Treat it like a password, keep it
> **outside the repo**, and never commit it. `token_v2` also expires roughly
> daily, so you'll be re-exporting often — fine for testing, not great for
> something meant to run unattended.

**Option C — OAuth refresh token (recommended for a real deployment),**
because unlike a cookie it doesn't expire:

```bash
gallery-dl oauth:reddit     # prints a refresh token
```

```env
REDDIT_REFRESH_TOKEN="..."
```

> If the token came from `gallery-dl oauth:reddit` (which uses gallery-dl's own
> client id), **leave `REDDIT_CLIENT_ID` empty**: a client id that doesn't match
> the token makes gallery-dl fail with `AuthenticationError`. Only set both
> together if the refresh token came from an app _you_ registered.

**Option D — Paste cookies in the UI.** Nothing to configure: open the
"Reddit authentication (optional)" panel in the app and paste a cookie string
(the built-in bookmarklet can grab one for you). These are used for that one
extraction, held in server memory, and **never written to disk, a DB, or a log**.

### Step 5 — Run it

```bash
pnpm dev     # http://localhost:3000
```

> After editing `.env.local` you must **restart** `pnpm dev` — env vars are not
> hot-reloaded.

### Step 6 — Use it

1. **Paste** one or more Reddit URLs into the big text box (or hit **Paste** to
   pull from your clipboard). It scrapes every Reddit URL out of whatever you
   paste, so you can dump a whole block of text in. The counter underneath tells
   you how many it found.
2. Click **Extract** (or press `Cmd/Ctrl + Enter`). Each URL is queued, and a
   card appears for it.
3. **Watch the cards.** Each one goes `Queued → Processing… → Ready` (or
   `Failed`, with the reason). Three run at a time.
4. **Download.** Hit **Download** on any ready card. If there are 2+ items,
   **Download all** grabs everything as a streaming ZIP.
5. NSFW posts show a blurred preview — click **Show (NSFW)** to reveal it.

## Environment variables

None are strictly required, but **without Reddit auth extraction will likely
fail** (see Step 4).

| Variable                                | What it's for                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GALLERY_DL_COOKIES_FROM_BROWSER`       | Auth via browser cookies (`chrome`, `firefox`, …). Simplest locally. Does **not** work in Docker. |
| `GALLERY_DL_COOKIES`                    | Auth via an exported `cookies.txt` (Netscape format). Works in Docker.                            |
| `REDDIT_REFRESH_TOKEN`                  | Auth via OAuth. Recommended for deployment — doesn't expire like a cookie.                        |
| `REDDIT_CLIENT_ID`                      | Only if the refresh token came from **your own** registered Reddit app (see Step 4).              |
| `GALLERY_DL_PATH` / `GALLERY_DL_CONFIG` | Binary path / explicit config, if not on the `PATH`.                                              |
| `YT_DLP_PATH` / `FFMPEG_PATH`           | Same, for video downloads.                                                                        |
| `DATABASE_URL`                          | Postgres (Neon) for anonymous logging. Optional.                                                  |

## Database (optional)

Only needed if you want anonymous download logging. With no `DATABASE_URL`,
logging is a no-op and the app works fine.

```bash
pnpm db:generate   # generate a migration from the schema (one already exists in drizzle/)
pnpm db:migrate    # apply migrations
pnpm db:push       # alternative: push the schema directly
pnpm db:studio     # browse the DB
```

The `download_events` table is anonymous: `subreddit`, `post_type`, `domain`,
`is_nsfw`, `has_audio`, `media_count`, `file_size_bytes`, `duration_seconds`,
`reddit_score`, `status`, `processing_ms`, `created_at`. **No** IP, no session.

## How it works

- **Extraction**: `processRedditUrl` delegates to `lib/gallerydl.ts`, which runs
  `gallery-dl -j <url>` (metadata only — no bytes) and normalizes the output into
  a `ResolvedPost`. gallery-dl resolves short/share links itself. That file is the
  **only** module that knows gallery-dl exists: swapping the tool means touching
  one file.
- **Queue**: `POST /api/extract` creates an in-memory job and enqueues each item
  (concurrency 3). The client subscribes to `GET /api/jobs/[id]` (SSE) and pushes
  every snapshot into the TanStack Query cache.
- **Downloads**: routes take `jobId`+`itemId`, **not** client-supplied URLs. The
  server resolves the URL from its own state and validates the host is a Reddit
  CDN, so the proxy can't be turned into an open SSRF relay. Everything streams;
  video temp dirs are always cleaned up.
- **State**: the job store lives in process memory (one stateless container). The
  only persistence is the anonymous Neon log.

## Deploy (Docker)

Built for a container host (**Railway**, **Fly**), **not** Vercel serverless
(long-running jobs + system binaries).

```bash
docker build -t reddit-downloader .
docker run -p 3000:3000 --env-file .env.local reddit-downloader
```

The image installs `ffmpeg` via apt, downloads the standalone `yt-dlp` binary (no
Python needed), and installs `gallery-dl` from PyPI into an isolated venv at
`/opt/gallery-dl` — gallery-dl publishes **no** standalone binary, so it does need
a Python runtime. They're wired up via `GALLERY_DL_PATH` / `YT_DLP_PATH` /
`FFMPEG_PATH`. The build smoke-tests both tools, so a missing binary fails the
**build** instead of every request at runtime. The container is stateless; the DB
is managed Neon.

For Reddit auth in Docker, `--cookies-from-browser` is **not** an option (no
browser): use `REDDIT_REFRESH_TOKEN` (recommended), or mount a `cookies.txt` and
point `GALLERY_DL_COOKIES` at it.

## Troubleshooting

- **Every job fails** → the `gallery-dl` binary is missing or not on your `PATH`.
  Check with `gallery-dl --version`; if it lives somewhere unusual, set
  `GALLERY_DL_PATH`.
- **"Reddit blocked the request" / WAF** → no auth configured. Set
  `GALLERY_DL_COOKIES_FROM_BROWSER`, `GALLERY_DL_COOKIES`, or
  `REDDIT_REFRESH_TOKEN` and **restart the server**. See Step 4.
- **Videos don't download locally** → `yt-dlp` (via youtube-dl-exec) is a Python
  zipapp needing **Python ≥3.10**. It fails on macOS's system Python 3.9; fix with
  `brew install yt-dlp` (or Python 3.10+). Already handled in Docker.
- **`external` posts** (YouTube, imgur, …) are marked unsupported on purpose.
- The job store is in-memory: running **multiple replicas** would require moving
  it to a shared store (out of scope today).

## Scripts

| Script                                                      | What it does       |
| ----------------------------------------------------------- | ------------------ |
| `pnpm dev`                                                  | dev server         |
| `pnpm build` / `pnpm start`                                 | prod build / serve |
| `pnpm typecheck`                                            | `tsc --noEmit`     |
| `pnpm lint` / `pnpm format`                                 | eslint / prettier  |
| `pnpm db:generate` / `db:migrate` / `db:push` / `db:studio` | Drizzle            |

---

<a name="español"></a>

# Español

Pegás una o varias URLs de Reddit y la app extrae el contenido multimedia
(imágenes, galerías y videos con audio) y te lo deja descargar.

Es una **única app de Next.js** (App Router): el "backend" son Route Handlers,
no hay servicio aparte.

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

> La interfaz de la app está en **inglés**.

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

## Puesta en marcha (paso a paso)

### Paso 1 — Instalar los requisitos

Necesitás **Node 22+**, **pnpm** y **`gallery-dl`**.

> ⚠️ **`gallery-dl` es obligatorio.** Es el único camino de extracción: si no está
> en el `PATH`, _todos_ los jobs fallan.

`yt-dlp` y `ffmpeg` sólo hacen falta para descargar **videos**; las imágenes y
galerías andan sin ellos.

```bash
# macOS (Homebrew)
brew install gallery-dl yt-dlp ffmpeg

# Linux / cualquier cosa con pipx
pipx install gallery-dl
```

Verificá que estén disponibles:

```bash
gallery-dl --version   # ej. 1.32.4
yt-dlp --version       # opcional (sólo video)
ffmpeg -version        # opcional (sólo video)
```

### Paso 2 — Instalar dependencias

```bash
pnpm install
```

### Paso 3 — Crear el archivo de entorno

```bash
cp .env.example .env.local
```

Ninguna variable es obligatoria, pero **sin alguna forma de auth de Reddit la
extracción probablemente falle** — ver Paso 4.

### Paso 4 — Darle a Reddit una razón para responderte

Reddit tiene un **WAF anti-bot** que bloquea IPs de datacenter y clientes que no
reconoce (_"blocked by network security"_). Hay que decirle a `gallery-dl` quién
es. Elegí **una**:

**Opción A — Cookies del navegador (lo más simple en local).**
Usa tu sesión de Reddit ya iniciada:

```env
GALLERY_DL_COOKIES_FROM_BROWSER="chrome"   # o firefox, safari, edge…
```

**Opción B — Un `cookies.txt` exportado.**
La única opción con cookies que anda en Docker (el contenedor no tiene navegador).
Exportalo en formato Netscape y montalo como secret/volumen:

```env
GALLERY_DL_COOKIES="/ruta/afuera/del/repo/cookies.txt"
```

> ⚠️ **Ese archivo _es_ tu sesión de Reddit.** Tratalo como una contraseña,
> guardalo **fuera del repo** y no lo commitees nunca. Además `token_v2` vence
> ~a diario, así que vas a tener que re-exportarlo seguido: sirve para probar,
> no es ideal para algo que quede corriendo solo.

**Opción C — OAuth refresh-token (recomendado para un deploy real),**
porque a diferencia de la cookie no vence:

```bash
gallery-dl oauth:reddit     # imprime un refresh token
```

```env
REDDIT_REFRESH_TOKEN="..."
```

> Si el token salió de `gallery-dl oauth:reddit` (que usa el client-id propio de
> gallery-dl), **dejá `REDDIT_CLIENT_ID` vacío**: un client-id que no coincide con
> el token hace fallar gallery-dl con `AuthenticationError`. Seteá los dos juntos
> sólo si el refresh-token salió de una app registrada por vos.

**Opción D — Pegar cookies en la UI.** No hay nada que configurar: abrí el panel
"Reddit authentication (optional)" en la app y pegá un string de cookies (el
bookmarklet incluido te lo copia). Se usan para esa única extracción, viven en
memoria del server y **nunca se escriben a disco, DB ni log**.

### Paso 5 — Levantarla

```bash
pnpm dev     # http://localhost:3000
```

> Después de editar `.env.local` hay que **reiniciar** `pnpm dev`: las env vars
> no se recargan en caliente.

### Paso 6 — Usarla

1. **Pegá** una o varias URLs de Reddit en el textarea (o tocá **Paste** para
   traerlas del portapapeles). Detecta todas las URLs de Reddit dentro del texto,
   así que podés pegar un bloque entero. El contador de abajo te dice cuántas
   encontró.
2. Tocá **Extract** (o `Cmd/Ctrl + Enter`). Cada URL entra a la cola y aparece
   una tarjeta.
3. **Mirá las tarjetas.** Cada una pasa por `Queued → Processing… → Ready` (o
   `Failed`, con el motivo). Se procesan de a 3.
4. **Descargá.** Botón **Download** en cualquier tarjeta lista. Si hay 2+ ítems,
   **Download all** te baja todo en un ZIP en streaming.
5. Los posts NSFW muestran una preview difuminada — tocá **Show (NSFW)** para
   revelarla.

## Variables de entorno

Ninguna es estrictamente obligatoria, pero **sin auth de Reddit la extracción
probablemente falle** (ver Paso 4).

| Variable                                | Para qué                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GALLERY_DL_COOKIES_FROM_BROWSER`       | Auth vía cookies del navegador (`chrome`, `firefox`, …). Lo más simple en local. **No** sirve en Docker. |
| `GALLERY_DL_COOKIES`                    | Auth vía `cookies.txt` exportado (formato Netscape). Sirve en Docker.                                    |
| `REDDIT_REFRESH_TOKEN`                  | Auth vía OAuth. Recomendado para deploy: no vence como la cookie.                                        |
| `REDDIT_CLIENT_ID`                      | Sólo si el refresh-token salió de **tu propia** app de Reddit (ver Paso 4).                              |
| `GALLERY_DL_PATH` / `GALLERY_DL_CONFIG` | Ruta del binario / config explícita, si no están en el `PATH`.                                           |
| `YT_DLP_PATH` / `FFMPEG_PATH`           | Ídem, para el download de video.                                                                         |
| `DATABASE_URL`                          | Postgres (Neon) para el logging anónimo. Opcional.                                                       |

## Base de datos (opcional)

Sólo hace falta si querés el logging anónimo de descargas. Sin `DATABASE_URL`, el
logging es no-op y la app funciona igual.

```bash
pnpm db:generate   # genera migración desde el schema (ya hay una en drizzle/)
pnpm db:migrate    # aplica migraciones
pnpm db:push       # alternativa: push directo del schema
pnpm db:studio     # explorar la DB
```

Tabla `download_events` (anónima): `subreddit`, `post_type`, `domain`,
`is_nsfw`, `has_audio`, `media_count`, `file_size_bytes`, `duration_seconds`,
`reddit_score`, `status`, `processing_ms`, `created_at`. **No** hay IP ni sesión.

## Cómo funciona

- **Extracción**: `processRedditUrl` delega en `lib/gallerydl.ts`, que corre
  `gallery-dl -j <url>` (sólo metadata, no baja bytes) y normaliza la salida a un
  `ResolvedPost`. gallery-dl resuelve solo los links cortos / de compartir. Es el
  **único** módulo que sabe que gallery-dl existe: si algún día se cambia la
  herramienta, sólo se toca ese archivo.
- **Cola**: `POST /api/extract` crea un job en memoria y encola cada ítem
  (concurrencia 3). El cliente se suscribe a `GET /api/jobs/[id]` (SSE) y vuelca
  cada snapshot al cache de TanStack Query.
- **Descargas**: referencian `jobId`+`itemId` (no URLs del cliente); el server
  resuelve la URL desde su estado y valida que el host sea CDN de Reddit, así el
  proxy no es un open-SSRF. Todo se streamea; los temporales de video se borran
  siempre al terminar.
- **Estado**: el store de jobs vive en memoria (1 contenedor stateless). La
  única persistencia es el log anónimo en Neon.

## Deploy (Docker)

Pensado para un host de contenedores (**Railway**, **Fly**), **no** Vercel
serverless (jobs largos + binarios).

```bash
docker build -t reddit-downloader .
docker run -p 3000:3000 --env-file .env.local reddit-downloader
```

La imagen instala `ffmpeg` por apt, baja el binario standalone de `yt-dlp` (no
necesita Python) e instala `gallery-dl` desde PyPI en un venv aislado en
`/opt/gallery-dl` — gallery-dl **no** publica binario standalone, así que sí
necesita un runtime de Python. Los usa vía `GALLERY_DL_PATH` / `YT_DLP_PATH` /
`FFMPEG_PATH`. El build corre un smoke test de ambos, así que un binario faltante
falla en **build** y no en cada request. El contenedor es stateless; la DB es Neon
gestionada.

Para la auth de Reddit en Docker, `--cookies-from-browser` **no** sirve (no hay
navegador): usá `REDDIT_REFRESH_TOKEN` (recomendado) o montá un `cookies.txt` y
apuntá `GALLERY_DL_COOKIES` a él.

## Limitaciones / Troubleshooting

- **Todos los jobs fallan** → falta el binario `gallery-dl`, o no está en el
  `PATH`. `gallery-dl --version` para chequear; si está en otro lado, seteá
  `GALLERY_DL_PATH`.
- **"Reddit blocked the request" / WAF** → falta auth. Configurá
  `GALLERY_DL_COOKIES_FROM_BROWSER`, `GALLERY_DL_COOKIES` o
  `REDDIT_REFRESH_TOKEN`, y **reiniciá el server**. Ver Paso 4.
- **Videos no descargan en local** → `yt-dlp` (vía youtube-dl-exec) es un zipapp
  de Python que necesita **Python ≥3.10**. En macOS con Python 3.9 falla;
  resolvé con `brew install yt-dlp` (o Python 3.10+). En Docker ya está resuelto.
- **`external`** (links a YouTube, imgur, etc.) se marcan como no soportados a
  propósito.
- El store de jobs es en memoria: con **múltiples réplicas** habría que moverlo a
  un store compartido (hoy fuera de scope).

## Scripts

| Script                                                      | Qué hace               |
| ----------------------------------------------------------- | ---------------------- |
| `pnpm dev`                                                  | dev server             |
| `pnpm build` / `pnpm start`                                 | build de prod / servir |
| `pnpm typecheck`                                            | `tsc --noEmit`         |
| `pnpm lint` / `pnpm format`                                 | eslint / prettier      |
| `pnpm db:generate` / `db:migrate` / `db:push` / `db:studio` | Drizzle                |
