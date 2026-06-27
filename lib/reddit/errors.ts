/**
 * Typed errors for the extraction pipeline so callers (the queue, route
 * handlers) can map failures to user-facing per-item states without parsing
 * error message strings.
 */

/**
 * Thrown when a redirect (or input URL) points at a host that is not Reddit.
 * This is the SSRF guard: we never follow redirects off Reddit's domains.
 */
export class NonRedditHostError extends Error {
  constructor(public readonly url: string) {
    super(`Redirect a un host no permitido (no es Reddit): ${url}`);
    this.name = "NonRedditHostError";
  }
}

export type RedditFetchErrorKind =
  | "rate_limit"
  | "not_found"
  | "forbidden"
  | "network"
  | "invalid_response";

/** Thrown when fetching or parsing the post .json fails. */
export class RedditFetchError extends Error {
  constructor(
    public readonly kind: RedditFetchErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "RedditFetchError";
  }
}
