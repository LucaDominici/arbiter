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
    // Generator tests create full project trees and (with the #1486 coverage suite) many files
    // stub process globals / spawn short-lived subprocesses; under full-suite parallelism on a
    // resource-constrained CI runner they compete for CPU. 30 s absorbs that contention (the 5 s
    // vitest default flaked; 20 s still flaked the heaviest coverage files in CI).
    testTimeout: 30000,
    // Integration tests are L2+ per AGENTS.md gate policy; L1 unit-only keeps pre-commit fast.
    include: ['__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '__tests__/integration/**'],
    // Integration tests use vi.doMock + dynamic import which requires process-level isolation to
    // avoid module-registry / process-global leaks across parallel test files. The #1486
    // coverage suite (__tests__/coverage/**) does the same — heavy vi.doMock + process.exit/stdout
    // stubs + real subprocess spawns — so it runs in the forks pool too: each file gets its own
    // process, so an unrestored global stub or a slow subprocess in one file cannot flake another.
    poolMatchGlobs: [
      ['**/__tests__/integration/**', 'forks'],
      ['**/__tests__/coverage/**', 'forks'],
    ],
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
      // "never erode from the current measured %" on all four axes. lines + branches are both
      // held at the 90 target (epic #1480: lines #1483, branches #1486 climb 78→90).
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 85,
      },
    },
  },
})
