// SPDX-License-Identifier: Apache-2.0
// Vitest config for integration smoke tests — runs __tests__/integration/ in the gate.
// Kept separate from vitest.config.ts so the main L1 unit-test run stays fast.
import { defineConfig } from 'vitest/config'
import { join, resolve } from 'node:path'
// #2282: one worker budget for both suites — scripts/check-all.mjs runs this
// config inside the same L2 gate, so an uncapped integration run would put the
// host right back into the oversubscription the unit cap just removed.
import { ciMaxWorkers } from './vitest.config'

const root = process.env.VITEST_ROOT ?? resolve('.')

export default defineConfig({
  root,
  resolve: { preserveSymlinks: true },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [join(root, 'vitest.setup.ts')],
    testTimeout: 60000,
    include: ['__tests__/integration/**/*.test.ts'],
    pool: 'forks',
    maxWorkers: ciMaxWorkers(),
  },
})
