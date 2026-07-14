/**
 * Ephemeral, in-memory Reddit cookies for the paste / bookmarklet auth flows.
 *
 * This is a *convenience* layer on top of the existing file/browser cookie
 * levers in `lib/gallerydl.ts` (`GALLERY_DL_COOKIES` / …_FROM_BROWSER) — it does
 * NOT replace them. When present, a request's cookies are handed to gallery-dl
 * as `-o cookies.<name>="<value>"` options, so nothing ever touches disk.
 *
 * Privacy contract (see the UI copy in `components/reddit-auth.tsx`):
 *   - Cookies are NEVER written to disk, a DB, or any log.
 *   - They live only in process memory, keyed by job id, and are evicted after
 *     a short TTL (or when the job is swept from the queue).
 *   - `redactCookieValues` scrubs values out of anything we might log/return.
 *
 * IMPORTANT: this store must never be attached to a `Job` (which is
 * `structuredClone`d into SSE frames sent to the client). Keep it separate —
 * this module is only ever imported by server code (routes, queue, gallerydl).
 */

/**
 * The Reddit cookies that matter for auth / getting past the bot-detection WAF.
 * Anything not on this list is dropped, so pasted junk (or an entire
 * `document.cookie` full of ad/analytics cookies) can't reach gallery-dl.
 *
 *   reddit_session, token_v2 — the real logged-in session. HttpOnly, so the
 *     bookmarklet CANNOT read them; only a manual paste (DevTools) carries them.
 *     Needed for NSFW / age-gated / private content.
 *   loid, edgebucket, session_tracker, csv, pc — non-HttpOnly. The bookmarklet
 *     can read these, and they alone are enough to clear the WAF for public
 *     content (verified against the live endpoint).
 */
export const REDDIT_COOKIE_NAMES = [
  "reddit_session",
  "token_v2",
  "loid",
  "edgebucket",
  "session_tracker",
  "csv",
  "pc",
] as const;

export type RedditCookies = Record<string, string>;

const ALLOWED = new Set<string>(REDDIT_COOKIE_NAMES);
// A single cookie value should never be huge; cap to reject pathological input.
const MAX_VALUE_LENGTH = 8 * 1024;

/**
 * Parse a pasted cookie string into a whitelisted `{ name: value }` map.
 *
 * Tolerant of the shapes a user might paste:
 *   - `document.cookie` output:      `a=b; c=d`
 *   - a raw `Cookie:` header:        `Cookie: a=b; c=d`
 *   - newline-separated pairs:       `a=b\nc=d`
 * Only known Reddit cookie names are kept; unknown/oversized/empty are dropped.
 * Returns an empty object when nothing usable is found — never throws.
 */
export function parseRedditCookies(input: string): RedditCookies {
  const cookies: RedditCookies = {};
  if (!input) return cookies;

  const cleaned = input.replace(/^\s*cookie:\s*/i, "");
  for (const part of cleaned.split(/[;\n]/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!ALLOWED.has(name)) continue;

    let value = part.slice(eq + 1).trim();
    // Strip a single layer of surrounding quotes if the user pasted them.
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (!value || value.length > MAX_VALUE_LENGTH) continue;
    cookies[name] = value;
  }
  return cookies;
}

/**
 * Build the gallery-dl args that inject these cookies in-memory:
 *   -o cookies.reddit_session="…" -o cookies.loid="…" …
 *
 * Values are JSON-encoded so they're always passed as strings — gallery-dl (via
 * python-requests) crashes on a bare numeric value like `csv=2`, and this also
 * escapes any quotes/backslashes safely.
 */
export function toGalleryDlCookieArgs(cookies: RedditCookies): string[] {
  const args: string[] = [];
  for (const [name, value] of Object.entries(cookies)) {
    args.push("-o", `cookies.${name}=${JSON.stringify(value)}`);
  }
  return args;
}

/**
 * Replace every cookie value in `text` with `[REDACTED]`. Used before logging or
 * surfacing any gallery-dl output that could conceivably echo a value (e.g. a
 * spawn error whose `.cmd` includes the args). Never log a cookie value.
 */
export function redactCookieValues(text: string, cookies?: RedditCookies): string {
  if (!text || !cookies) return text;
  let out = text;
  for (const value of Object.values(cookies)) {
    if (value) out = out.split(value).join("[REDACTED]");
  }
  return out;
}

// --- Ephemeral per-job store ------------------------------------------------
// Cookies arrive with the extract request but are needed later, in the separate
// download requests. We hold them in memory keyed by job id, with a TTL so they
// don't linger. Lives on globalThis so it survives HMR in dev, like the queue.

const SESSION_TTL_MS = 60 * 60 * 1000; // matches the job queue's 1h eviction

interface CookieEntry {
  cookies: RedditCookies;
  timer: ReturnType<typeof setTimeout>;
}

const globalForCookies = globalThis as unknown as {
  __redditSessionCookies?: Map<string, CookieEntry>;
};

function getStore(): Map<string, CookieEntry> {
  if (!globalForCookies.__redditSessionCookies) {
    globalForCookies.__redditSessionCookies = new Map();
  }
  return globalForCookies.__redditSessionCookies;
}

/** Associate cookies with a job id. No-op for an empty set. */
export function storeSessionCookies(jobId: string, cookies: RedditCookies): void {
  if (Object.keys(cookies).length === 0) return;
  const store = getStore();
  clearSessionCookies(jobId); // replace any prior entry + its timer

  const timer = setTimeout(() => store.delete(jobId), SESSION_TTL_MS);
  if (typeof timer.unref === "function") timer.unref();
  store.set(jobId, { cookies, timer });
}

/** Cookies for a job, or undefined if none/expired. */
export function getSessionCookies(jobId: string): RedditCookies | undefined {
  return getStore().get(jobId)?.cookies;
}

/** Drop a job's cookies from memory (called on job sweep and on replace). */
export function clearSessionCookies(jobId: string): void {
  const store = getStore();
  const entry = store.get(jobId);
  if (entry) {
    clearTimeout(entry.timer);
    store.delete(jobId);
  }
}
