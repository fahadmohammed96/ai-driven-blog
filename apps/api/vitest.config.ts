import { defineConfig } from "vitest/config";

// Default run: fast unit/architecture tests only. Integration tests
// (Testcontainers, require Docker) run via `test:integration`.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
  },
});
