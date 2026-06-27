import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    testTimeout: 30_000,
    // Schema isolation test bootstraps pglite + a Postgres schema; allow extra time.
    hookTimeout: 60_000,
    pool: "forks",
  },
});