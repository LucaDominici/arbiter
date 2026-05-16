// SPDX-License-Identifier: Apache-2.0
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { runVerifyTdd } from '../../../src/commands/verify-tdd.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('TDD evidence gate — integration (dogfood)', () => {
  it('verifies #551 evidence — this task must have recorded TDD evidence before advancing to green', () => {
    // Dogfood: this task enforces the very gate it implements.
    // Record evidence first: npx tsx src/cli.ts task record-red --test-path __tests__/integration/gate/tdd-evidence-l2.test.ts
    const result = runVerifyTdd({ taskId: '#551', dir: repoRoot })
    expect(result.status).toBe('PASS')
    expect(result.checks).toHaveLength(4)
    expect(result.checks?.every((c) => c.pass)).toBe(true)
  })
})
