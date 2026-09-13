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
      // Stubs HOME/USERPROFILE (vi.stubEnv) to fake a Codex auth.json under a tmp dir. Hermetic
      // under the forks pool T1 uses (one process per file), but the threads pool this config
      // forces shares process.env across concurrently-running files in the same worker, so the
      // stub can race with a real HOME lookup elsewhere — not a real Codex-login dependency.
      // Zero overlap with the `mutate` targets above, so this costs no mutation coverage.
      '__tests__/commands/doctor.test.ts',
    ],
  },
})
