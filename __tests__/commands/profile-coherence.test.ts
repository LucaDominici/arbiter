// SPDX-License-Identifier: Apache-2.0
//
// #1306 (ADR-094 §Decision.5) — doctor coherence for the Project-Profile
// orchestration prefs. maxParallelWorktrees > 1 + trunk-solo is CRITICAL;
// defaultGateLevel L1 + L3/L4 governance is WARN.
import { describe, it, expect } from 'vitest'
import { validateProfileCoherence } from '../../src/commands/wizard/coherence.js'

describe('validateProfileCoherence — maxParallelWorktrees × collaborationMode (#1306)', () => {
  it('CRITICAL: maxParallelWorktrees > 1 under trunk-solo (worktree: never)', () => {
    const r = validateProfileCoherence(3, 'L2', 'trunk-solo', 'L2')
    expect(r.valid).toBe(false)
    expect(r.severity).toBe('CRITICAL')
    expect(r.message).toContain('trunk-solo')
    expect(r.remediation).toBeTruthy()
  })

  it('OK: maxParallelWorktrees > 1 under peer-review', () => {
    expect(validateProfileCoherence(3, 'L2', 'peer-review', 'L2').severity).toBe('OK')
  })

  it('OK: maxParallelWorktrees = 1 under trunk-solo', () => {
    expect(validateProfileCoherence(1, 'L1', 'trunk-solo', 'L2').severity).toBe('OK')
  })

  it('absent maxParallelWorktrees treated as coherent floor (1) under trunk-solo', () => {
    expect(validateProfileCoherence(undefined, undefined, 'trunk-solo', 'L2').severity).toBe('OK')
  })
})

describe('validateProfileCoherence — defaultGateLevel × governanceLevel (#1306)', () => {
  it('WARN: defaultGateLevel L1 under L3 governance', () => {
    const r = validateProfileCoherence(1, 'L1', 'peer-review', 'L3')
    expect(r.severity).toBe('WARN')
    expect(r.valid).toBe(true)
    expect(r.message).toContain('L1')
  })

  it('WARN: defaultGateLevel L1 under L4 governance', () => {
    expect(validateProfileCoherence(1, 'L1', 'peer-review', 'L4').severity).toBe('WARN')
  })

  it('OK: defaultGateLevel L1 under L2 governance', () => {
    expect(validateProfileCoherence(1, 'L1', 'peer-review', 'L2').severity).toBe('OK')
  })

  it('OK: defaultGateLevel L2 under L3 governance', () => {
    expect(validateProfileCoherence(1, 'L2', 'peer-review', 'L3').severity).toBe('OK')
  })
})

describe('validateProfileCoherence — precedence (#1306)', () => {
  it('the trunk-solo worktree CRITICAL takes priority over a gate-level WARN', () => {
    // Both conditions true → the CRITICAL (worktree) result is returned first.
    const r = validateProfileCoherence(2, 'L1', 'trunk-solo', 'L3')
    expect(r.severity).toBe('CRITICAL')
  })
})
