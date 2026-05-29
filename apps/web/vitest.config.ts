import { defineConfig } from "vitest/config";

// Unit tests only; Playwright E2E lives in ./e2e and runs via `pnpm e2e`.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "e2e/**"],
  },
});
