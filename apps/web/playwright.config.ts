import { defineConfig } from "@playwright/test";

// The journey drives the web UI, which calls the API. Playwright boots both:
// the API self-migrates/seeds and ensures the bucket on start (DB_AUTO_MIGRATE).
// Postgres + MinIO must be up (pnpm stack:up locally; service/compose in CI).
const apiEnv: Record<string, string> = {
  PORT: "3000",
  DB_AUTO_MIGRATE: "1",
  // Admin connection bootstraps (migrate/seed/provision app role); the app runs
  // as the NOSUPERUSER app role so RLS is enforced at runtime (DEBT-005).
  DATABASE_ADMIN_URL: process.env.DATABASE_ADMIN_URL ?? "postgresql://blogs:blogs@localhost:5432/blogs",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://app_rw:app_rw@localhost:5432/blogs",
  APP_DB_PASSWORD: process.env.APP_DB_PASSWORD ?? "app_rw",
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  S3_REGION: process.env.S3_REGION ?? "us-east-1",
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? "minio",
  S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? "minio12345",
  S3_BUCKET: process.env.S3_BUCKET ?? "media",
  // Seals per-tenant BYOK keys in connector_credentials (Slice T2). Any non-empty
  // value works for e2e; production provisions a real secret (DEBT-008/023).
  CONNECTOR_SECRET_KEY: process.env.CONNECTOR_SECRET_KEY ?? "e2e-connector-secret-key",
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  // The e2e specs share one backend/tenant (the founder settings row, etc.), so
  // running specs concurrently races on shared mutable state (budget/settings get
  // clobbered mid-test). Run serially for a deterministic gate — the suite is fast
  // (~21 quick specs) so the wall-clock cost is small.
  workers: 1,
  use: { baseURL: "http://localhost:3100" },
  webServer: [
    {
      command: "node ../api/dist/main.js",
      port: 3000,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: apiEnv,
    },
    {
      command: "pnpm exec next start -p 3100",
      url: "http://localhost:3100",
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
