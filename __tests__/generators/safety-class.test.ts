// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { isSafetyClassKey } from '../../src/generators/safety-class.js'

describe('isSafetyClassKey (T1 safety-class manifest)', () => {
  it('matches every emitted .claude/hooks/*.mjs file', () => {
    expect(isSafetyClassKey('.claude/hooks/stop-dangerous.mjs')).toBe(true)
    expect(isSafetyClassKey('.claude/hooks/stop-evidence-guard.mjs')).toBe(true)
    expect(isSafetyClassKey('.claude/hooks/guard-done-evidence.mjs')).toBe(true)
    expect(isSafetyClassKey('.claude/hooks/hooks.mjs')).toBe(true)
    expect(isSafetyClassKey('.claude/hooks/lib.mjs')).toBe(true)
  })

  it('does not match files outside .claude/hooks/', () => {
    expect(isSafetyClassKey('.claude/rules/50-batch-execution.md')).toBe(false)
    expect(isSafetyClassKey('scripts/check-all.mjs')).toBe(false)
    expect(isSafetyClassKey('.claude/settings.json')).toBe(false)
    expect(isSafetyClassKey('arbiter.json')).toBe(false)
  })

  it('does not match a nested subdirectory under .claude/hooks/ (single segment only)', () => {
    expect(isSafetyClassKey('.claude/hooks/sub/stop-dangerous.mjs')).toBe(false)
  })

  it('does not match a non-.mjs file inside .claude/hooks/', () => {
    expect(isSafetyClassKey('.claude/hooks/README.md')).toBe(false)
  })

  it('requires the leading .claude/ prefix (no partial/absolute-path match)', () => {
    expect(isSafetyClassKey('claude/hooks/stop-dangerous.mjs')).toBe(false)
    expect(isSafetyClassKey('/root/.claude/hooks/stop-dangerous.mjs')).toBe(false)
  })
})
