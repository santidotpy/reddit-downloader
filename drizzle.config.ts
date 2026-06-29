import { readFileSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit (unlike Next) doesn't auto-load .env.local, so DATABASE_URL would
// be empty when running migrate/push/studio. Load it from .env.local without
// pulling in a dependency. A real env var (if already set) takes precedence.
if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/);
      if (match) {
        process.env.DATABASE_URL = match[1].replace(/^['"]|['"]$/g, "");
        break;
      }
    }
  } catch {
    // no .env.local — leave DATABASE_URL unset; drizzle-kit will error clearly.
  }
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Required for `migrate`/`push`/`studio`; not needed for `generate`.
    url: process.env.DATABASE_URL ?? "",
  },
});
