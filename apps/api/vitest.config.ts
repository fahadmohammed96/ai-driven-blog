import { defineConfig } from "vitest/config";

// Default run: fast unit/architecture tests only.
// - Integration tests (Testcontainers, Docker) -> `test:integration`
// - Nest HTTP tests (swc transform) -> `test:http`
export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.integration.test.ts",
      "**/*.http.test.ts",
    ],
  },
});
