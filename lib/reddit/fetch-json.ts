/**
 * Fetch and validate a Reddit post's JSON.
 *
 * `raw_json=1` makes Reddit return unescaped URLs (no `&amp;`), so media URLs
 * in `media_metadata` are directly usable without HTML-entity decoding.
 */
import { getRedditUserAgent } from "./user-agent";
import { RedditFetchError } from "./errors";
import { listingResponseSchema, type RedditPostData } from "./schema";

const REQUEST_TIMEOUT_MS = 15_000;

export async function fetchPostJson(permalink: string): Promise<RedditPostData> {
  const base = permalink.replace(/\/+$/, "");
  const jsonUrl = `${base}.json?raw_json=1`;

  let res: Response;
  try {
    res = await fetch(jsonUrl, {
      headers: {
        "user-agent": getRedditUserAgent(),
        accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    throw new RedditFetchError(
      "network",
      timedOut
        ? "Reddit no respondió a tiempo (timeout)."
        : `No se pudo conectar con Reddit: ${String(cause)}`,
    );
  }

  switch (res.status) {
    case 429:
      throw new RedditFetchError(
        "rate_limit",
        "Reddit limitó la tasa de requests (429). Probá de nuevo en unos segundos.",
      );
    case 404:
      throw new RedditFetchError(
        "not_found",
        "El post no existe o fue borrado (404).",
      );
    case 403:
      throw new RedditFetchError(
        "forbidden",
        "Acceso denegado por Reddit (403): puede ser un subreddit privado o con restricción.",
      );
  }
  if (!res.ok) {
    throw new RedditFetchError("network", `Reddit respondió ${res.status}.`);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new RedditFetchError(
      "invalid_response",
      "Reddit no devolvió JSON válido.",
    );
  }

  const parsed = listingResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new RedditFetchError(
      "invalid_response",
      "La respuesta de Reddit no tiene el formato esperado (¿es un link a un post?).",
    );
  }

  const children = parsed.data[0].data.children;
  // Posts are kind "t3"; fall back to the first child if kind is absent.
  const post =
    children.find((c) => c.kind === "t3")?.data ?? children[0]?.data;
  if (!post) {
    throw new RedditFetchError(
      "invalid_response",
      "No se encontró ningún post en la respuesta de Reddit.",
    );
  }
  return post;
}
