import { defineConfig } from 'vitest/config'
import { join, resolve } from 'node:path'

// Worktree paths containing '#' break Vite's URL parsing (fragment separator).
// Use VITEST_ROOT env var with a symlink path without '#' to work around this.
const root = process.env.VITEST_ROOT ?? resolve('.')

export default defineConfig({
  root,
  resolve: {
    preserveSymlinks: true,
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [join(root, 'vitest.setup.ts')],
    // Integration tests are L2+ per AGENTS.md gate policy; L1 unit-only keeps pre-commit fast.
    include: ['__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '__tests__/integration/**'],
    // Integration tests use vi.doMock + dynamic import which requires process-level
    // isolation to avoid module registry leaks across parallel test files.
    poolMatchGlobs: [['**/__tests__/integration/**', 'forks']],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 85,
        branches: 75,
        functions: 90,
        statements: 85,
      },
    },
  },
})
