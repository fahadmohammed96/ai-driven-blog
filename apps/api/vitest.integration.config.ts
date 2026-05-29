import { defineConfig } from "vitest/config";

// Integration tests against real dependencies via Testcontainers (need Docker).
export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
