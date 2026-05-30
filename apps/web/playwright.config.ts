import { defineConfig } from "@playwright/test";

// The journey drives the web UI, which calls the API. Playwright boots both:
// the API self-migrates/seeds and ensures the bucket on start (DB_AUTO_MIGRATE).
// Postgres + MinIO must be up (pnpm stack:up locally; service/compose in CI).
const apiEnv: Record<string, string> = {
  PORT: "3000",
  DB_AUTO_MIGRATE: "1",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://blogs:blogs@localhost:5432/blogs",
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  S3_REGION: process.env.S3_REGION ?? "us-east-1",
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? "minio",
  S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? "minio12345",
  S3_BUCKET: process.env.S3_BUCKET ?? "media",
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
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
