/**
 * Reddit requires a descriptive, identifiable User-Agent. Using a generic or
 * missing UA gets you aggressively rate-limited (429). Configurable via the
 * REDDIT_USER_AGENT env var.
 */
const DEFAULT_USER_AGENT =
  "reddit-downloader/0.1 (self-hosted media downloader; +https://github.com)";

export function getRedditUserAgent(): string {
  const ua = process.env.REDDIT_USER_AGENT?.trim();
  return ua && ua.length > 0 ? ua : DEFAULT_USER_AGENT;
}
