import { defineConfig } from 'vitest/config'
import { join, resolve } from 'node:path'
import { availableParallelism } from 'node:os'

// Worktree paths containing '#' break Vite's URL parsing (fragment separator).
// Use VITEST_ROOT env var with a symlink path without '#' to work around this.
const root = process.env.VITEST_ROOT ?? resolve('.')

/**
 * Worker-pool ceiling for CI (#2282).
 *
 * vitest sizes its fork pool at `availableParallelism() - 1` when no cap is set.
 * The self-hosted runner containers carry no CPU limit, so that call reports the
 * 24-core HOST and a single CI job spawns ~23 forks on its own. The farm runs up
 * to four heavy slots and the same box also serves other agents' local gates, so
 * the real figure was ~90 forks over 24 cores. The red run says so in its own
 * summary: `Duration 198.39s (transform 155.09s, ... import 451.24s)` — 606 s of
 * CPU against 198 s of wall from one job.
 *
 * Under that thrash a test costing ~3 s at rest blows the 30 s wall-clock
 * `testTimeout`, and which test loses the race is scheduler-dependent — hence a
 * different failing test per job on an identical SHA, with zero assertion
 * failures. The cure is to make the suite fit the machine, not to widen the
 * timeout, which would only hide the signal.
 *
 * 4 is the fair share: four slots x 4 workers = 16 of 24 cores, leaving headroom
 * for the local gates the host also runs. The `availableParallelism()` bound
 * keeps it honest on the GitHub-hosted 4-core fallback declared in
 * `vars.RUNNER_LABELS_TEST`. Local runs stay on the vitest default.
 * `VITEST_MAX_WORKERS` overrides this natively inside vitest, so tuning needs no
 * config edit.
 */
export function ciMaxWorkers(env: NodeJS.ProcessEnv = process.env): number | undefined {
  return env.CI ? Math.max(1, Math.min(4, availableParallelism() - 1)) : undefined
}

export default defineConfig({
  root,
  resolve: {
    preserveSymlinks: true,
  },
  test: {
    globals: true,
    environment: 'node',
    globalSetup: [join(root, '__tests__/setup/tracked-claude-guard.ts')],
    setupFiles: [join(root, 'vitest.setup.ts')],
    // Generator tests create full project trees and (with the #1486 coverage suite) many files
    // stub process globals / spawn short-lived subprocesses; under full-suite parallelism on a
    // resource-constrained CI runner they compete for CPU. 30 s absorbs that contention (the 5 s
    // vitest default flaked; 20 s still flaked the heaviest coverage files in CI).
    testTimeout: 30000,
    // #2282: bound the fork pool in CI — see ciMaxWorkers above.
    maxWorkers: ciMaxWorkers(),
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
        // Anchored to the resolved root on purpose: coverage exclude globs are
        // matched containment-style against ABSOLUTE file paths, so a bare
        // '.claude/**' running in a git worktree rooted under
        // .claude/worktrees/<id>/ matched EVERY file (the root's own ancestry
        // contains '.claude/') and silently zeroed coverage — which then failed
        // the coverage ratchet with "missing total.lines.pct". The anchored form
        // excludes only THIS project's .claude directory in both layouts.
        `${root}/.claude/**`,
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
