import { defineConfig } from "drizzle-kit";

// schema.ts is the typed source of truth. `pnpm db:generate` produces migrations
// in ./drizzle. NB: the baseline migration is hand-tuned for the pgvector
// extension ordering and RLS FORCE/policies (see drizzle/README.md).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/platform/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://blogs:blogs@localhost:5432/blogs",
  },
});
