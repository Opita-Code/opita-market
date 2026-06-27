import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/types/**/*.ts",
        "src/**/*.d.ts",
        // PR 6: route handlers + auth middleware are tested via integration
        // tests in PR 8 (with testcontainers DynamoDB + LocalStack).
        // Excluded from coverage for now — without .skip integration tests,
        // these would force-fail the 90% gate.
        "src/api/**/*.ts",
        "src/lib/auth.ts",
        "src/lib/http-errors.ts",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});