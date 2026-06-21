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
    // Generator tests create full project trees; under full-suite parallelism
    // they compete for CPU and easily exceed the 5 s vitest default.
    testTimeout: 20000,
    // Integration tests are L2+ per AGENTS.md gate policy; L1 unit-only keeps pre-commit fast.
    include: ['__tests__/**/*.test.ts'],
    // Generous timeout: hook rsyncs to tmp, competing for CPU → 5 s default causes flaky timeouts.
    testTimeout: 20000,
    exclude: ['**/node_modules/**', '__tests__/integration/**'],
    // Integration tests use vi.doMock + dynamic import which requires process-level
    // isolation to avoid module registry leaks across parallel test files.
    poolMatchGlobs: [['**/__tests__/integration/**', 'forks']],
    coverage: {
      provider: 'v8',
      // json-summary feeds the coverage no-regression ratchet (scripts/check-coverage-ratchet.mjs):
      // coverage/coverage-summary.json is the deterministic, machine-readable source of truth.
      reporter: ['text', 'lcov', 'json-summary'],
      // Measure the coverage floor against shipped product code only. Build/dev
      // tooling (scripts/*.mjs, .claude/hooks/*) and test helpers are exercised
      // incidentally by tests but are not the product; counting them made the
      // global average a misleading proxy for product-code quality.
      exclude: [
        'node_modules/**',
        'dist/**',
        '__tests__/**',
        'scripts/**',
        '.claude/**',
        '**/*.config.ts',
      ],
      // Absolute floors (the suite fails below these). The coverage no-regression ratchet
      // (scripts/check-coverage-ratchet.mjs + .coverage-baseline.json) enforces the tighter
      // "never erode from the current measured %" on all four axes. lines is held at the 90
      // target (#1483); branches climbs toward 90 under the ratchet (epic #1480 PR3+).
      thresholds: {
        lines: 90,
        branches: 75,
        functions: 90,
        statements: 85,
      },
    },
  },
})
