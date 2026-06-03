import { defineConfig } from "vitest/config";

// Integration tests against real dependencies via Testcontainers (need Docker).
export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // Each test file spins its own Postgres/Mailhog container; starting too many
    // at once overwhelms Docker (fast beforeAll failures under contention → flaky
    // gate). Cap concurrency for deterministic runs.
    maxWorkers: 2,
    minWorkers: 1,
  },
});
