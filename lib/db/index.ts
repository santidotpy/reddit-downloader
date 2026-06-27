/**
 * Neon serverless (HTTP) Drizzle client.
 *
 * Lazily constructed and cached. If DATABASE_URL is unset (e.g. local dev
 * without a database) this returns `null`, and logging becomes a no-op — the
 * app still works, it just doesn't record events.
 */
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

type Db = NeonHttpDatabase<typeof schema>;

let cached: Db | null | undefined;

export function getDb(): Db | null {
  if (cached !== undefined) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) {
    cached = null;
    return cached;
  }

  cached = drizzle(neon(url), { schema });
  return cached;
}
