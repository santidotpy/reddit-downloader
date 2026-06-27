import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Required for `migrate`/`push`/`studio`; not needed for `generate`.
    url: process.env.DATABASE_URL ?? "",
  },
});
