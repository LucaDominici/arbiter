// SPDX-License-Identifier: Apache-2.0
// #2673: Stryker runs in place (the sandbox copy has no .git, and gate tests shell out to git).
// In-place instrumentation rewrites the mutated sources on disk, so the one suite that asserts a
// template render is byte-equal to a dogfooded self script cannot hold while mutants are live.
// It is a dogfood-parity check, not a unit test of the mutated generators, and stays in L2.
import { mergeConfig } from 'vitest/config'
import base from './vitest.config.js'

export default mergeConfig(base, {
  test: {
    exclude: [
      '__tests__/templates/acceptance-anchor-scripts-render.test.ts',
      // The runner forces vitest's `threads` pool, where process.chdir() is unavailable; these
      // suites pin the "no --dir → cwd" branches and can only run under the forks pool (L2).
      '__tests__/coverage/configure-interactive.cov.test.ts',
      '__tests__/coverage/doctor-edge.cov.test.ts',
      '__tests__/coverage/task-note.cov.test.ts',
      '__tests__/scripts/check-touched-vs-manifest.test.ts',
      '__tests__/commands/doctor-tool-pins.test.ts',
      '__tests__/commands/doctor-gate-pass.test.ts',
      '__tests__/commands/explain.test.ts',
      '__tests__/commands/explain-handoff.test.ts',
      '__tests__/integrations/companions.test.ts',
    ],
  },
})
