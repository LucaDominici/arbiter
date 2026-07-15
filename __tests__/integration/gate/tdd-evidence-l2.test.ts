// SPDX-License-Identifier: Apache-2.0
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { runVerifyTdd } from '../../../src/commands/verify-tdd.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('TDD evidence gate — integration (dogfood)', () => {
  it('verifies #551 evidence — the 5 pre-#1957 checks still pass on this real, historical evidence', () => {
    // Dogfood: this task enforces the very gate it implements.
    // Record evidence first: npx tsx src/cli.ts task record-red --test-path __tests__/integration/gate/tdd-evidence-l2.test.ts
    //
    // #551's evidence predates #1957's red-execution check and has no
    // test_command (added by #1951, after #551 landed). Per #1957's explicit
    // migration requirement — "old path-only evidence cannot silently claim
    // compliance" — that check now fails closed for this evidence instead of
    // being silently skipped. This is not a regression in #551's own work:
    // the other 5 checks (the full pre-#1957 guarantee) still all pass.
    // Re-verifying #551's actual RED phase from source is also structurally
    // impossible post-hoc: `record-red` captured the failure log BEFORE the
    // evidence file existed on disk, but by the time the commit landed, the
    // evidence file was committed alongside it — so a fresh checkout of
    // test_commit_sha would find the evidence file already present and the
    // self-referential assertion passing, not failing.
    const result = runVerifyTdd({ taskId: '#551', dir: repoRoot })
    expect(result.status).toBe('FAIL')
    expect(result.checks).toHaveLength(6)
    expect(result.checks?.slice(0, 5).every((c) => c.pass)).toBe(true)
    const reExecCheck = result.checks?.[5]
    expect(reExecCheck?.name).toBe('red-execution')
    expect(reExecCheck?.pass).toBe(false)
    expect(result.reason).toMatch(/test_command/)
  }, 30_000)
})
