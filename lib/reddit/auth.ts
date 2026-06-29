/**
 * Reddit application-only ("userless") OAuth.
 *
 * Reddit increasingly returns 403 for the unauthenticated `.json` endpoint.
 * When REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET are set (register an app at
 * https://www.reddit.com/prefs/apps), we fetch an app-only bearer token via the
 * client_credentials grant and hit `oauth.reddit.com` instead.
 *
 * The token is cached in-process until shortly before it expires.
 */
import { getRedditUserAgent } from "./user-agent";
import { RedditFetchError } from "./errors";

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;

export function hasRedditOAuth(): boolean {
  return Boolean(
    process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET,
  );
}

/** Returns a bearer token, or null if OAuth isn't configured. */
export async function getRedditAccessToken(): Promise<string | null> {
  if (!hasRedditOAuth()) return null;

  // Reuse the cached token until 60s before expiry.
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const id = process.env.REDDIT_CLIENT_ID as string;
  const secret = process.env.REDDIT_CLIENT_SECRET as string;
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");

  let res: Response;
  try {
    res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": getRedditUserAgent(),
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    throw new RedditFetchError(
      "network",
      `No se pudo contactar el endpoint de token de Reddit: ${String(cause)}`,
    );
  }

  if (!res.ok) {
    throw new RedditFetchError(
      "forbidden",
      `Reddit rechazó las credenciales OAuth (${res.status}). Revisá REDDIT_CLIENT_ID/SECRET.`,
    );
  }

  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
  } | null;

  if (!data?.access_token) {
    throw new RedditFetchError(
      "invalid_response",
      "Reddit no devolvió un access_token.",
    );
  }

  cached = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}
