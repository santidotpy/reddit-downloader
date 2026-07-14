/**
 * URL detection + host validation for Reddit.
 *
 * `detectRedditUrls` pulls every Reddit URL out of arbitrary pasted text;
 * `isRedditHost` / `isRedditMediaHost` are the host allowlists.
 *
 * Short/share-link resolution (redd.it/xxx, reddit.com/r/.../s/xxx) is no longer
 * done here — gallery-dl resolves those itself (see `lib/gallerydl.ts`).
 *
 * SSRF guard: `isRedditMediaHost` gates the download proxy so it can only ever
 * fetch from a Reddit CDN, never an arbitrary client-supplied domain.
 */

const REDDIT_BASE_HOSTS = ["reddit.com", "redd.it"] as const;

/** True if `hostname` is reddit.com / redd.it or a subdomain of either. */
export function isRedditHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return REDDIT_BASE_HOSTS.some(
    (base) => host === base || host.endsWith(`.${base}`),
  );
}

const REDDIT_MEDIA_SUFFIXES = [".redd.it", ".redditmedia.com"] as const;

/**
 * True if `hostname` is a Reddit media CDN (i.redd.it, preview.redd.it,
 * v.redd.it, *.redditmedia.com, …). Used to gate the download proxy so it can't
 * be turned into an open SSRF proxy.
 */
export function isRedditMediaHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "redd.it") return true;
  return REDDIT_MEDIA_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

// Matches Reddit URLs with or without scheme. The leading negative lookbehind
// prevents matching inside a larger host (e.g. "evilreddit.com"). Any over-match
// is still re-validated by `new URL().hostname` + `isRedditHost` below.
const REDDIT_URL_REGEX =
  /(?<![\w.@-])(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:reddit\.com|redd\.it)\/[^\s"'<>)\]}]+/gi;

/** Extract all unique, host-validated Reddit URLs from pasted text. */
export function detectRedditUrls(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(REDDIT_URL_REGEX)) {
    const normalized = normalizeUrl(match[0]);
    if (normalized) found.add(normalized);
  }
  return [...found];
}

/** Add a scheme if missing, validate it's a Reddit host, return canonical string. */
function normalizeUrl(raw: string): string | null {
  // Strip trailing punctuation that commonly clings to pasted URLs.
  let candidate = raw.trim().replace(/[.,;:!?)\]}>'"]+$/, "");
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!isRedditHost(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
