/**
 * URL detection + short/share-link resolution for Reddit.
 *
 * Two responsibilities:
 *  1. `detectRedditUrls` — pull every Reddit URL out of arbitrary pasted text.
 *  2. `resolveRedditUrl` — follow short (redd.it/xxx) and share
 *     (reddit.com/r/.../s/xxx) links to their canonical permalink.
 *
 * SSRF guard: redirects are followed manually and the host is re-validated as
 * Reddit on EVERY hop. We never follow a redirect to an arbitrary domain.
 */
import { getRedditUserAgent } from "./user-agent";
import { NonRedditHostError, RedditFetchError } from "./errors";

const REDDIT_BASE_HOSTS = ["reddit.com", "redd.it"] as const;
const MAX_REDIRECTS = 8;
const REQUEST_TIMEOUT_MS = 12_000;

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

/** A canonical comments permalink doesn't need redirect resolution. */
function isCanonicalPermalink(url: URL): boolean {
  return /\/comments\/[a-z0-9]+/i.test(url.pathname);
}

/** Drop query/hash and trailing slashes; this is what we append `.json` to. */
function canonicalizePermalink(url: URL): string {
  return `https://${url.hostname}${url.pathname}`.replace(/\/+$/, "");
}

/**
 * Resolve a (possibly short/share) Reddit URL to its canonical permalink by
 * following redirects manually, re-validating the host on each hop.
 *
 * @throws {NonRedditHostError} if any hop leaves Reddit's domains.
 */
export async function resolveRedditUrl(rawUrl: string): Promise<string> {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) throw new NonRedditHostError(rawUrl);

  let current = new URL(normalized);

  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    // Re-validate every hop (the input may already be off-domain; a redirect
    // may try to send us off-domain).
    if (!isRedditHost(current.hostname)) {
      throw new NonRedditHostError(current.toString());
    }
    // Already canonical: no need to spend a request resolving it.
    if (isCanonicalPermalink(current)) return canonicalizePermalink(current);

    let res: Response;
    try {
      res = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        headers: { "user-agent": getRedditUserAgent(), accept: "text/html" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      throw new RedditFetchError(
        "network",
        timedOut
          ? `Reddit no respondió al resolver el link (timeout): ${current.toString()}`
          : `No se pudo resolver el link: ${String(cause)}`,
      );
    }
    // We never read the body during resolution — release the socket.
    await res.body?.cancel().catch(() => {});

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return canonicalizePermalink(current);
      const next = new URL(location, current);
      if (!isRedditHost(next.hostname)) {
        throw new NonRedditHostError(next.toString());
      }
      current = next;
      continue;
    }

    // Not a redirect — treat the current URL as final.
    return canonicalizePermalink(current);
  }

  throw new Error(`Demasiados redirects al resolver la URL: ${rawUrl}`);
}
