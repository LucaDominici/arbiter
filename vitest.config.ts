import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    // Integration tests use vi.doMock + dynamic import which requires process-level
    // isolation to avoid module registry leaks across parallel test files.
    poolMatchGlobs: [["**/__tests__/integration/**", "forks"]],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 85,
        branches: 75,
        functions: 90,
        statements: 85,
      },
    },
  },
});
