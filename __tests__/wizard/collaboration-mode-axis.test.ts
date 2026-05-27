// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests — Phase B types layer (micro-cycle 1)
 * Validates CollaborationMode type shapes, alias resolution,
 * and ProjectConfig field presence. Non-regression guard for #1080.
 */
import { describe, it, expect } from 'vitest'
import type {
  CollaborationMode,
  BranchingStrategy,
  SoloMergeMode,
  WorktreeAutoMode,
  ProjectConfig,
  WizardAnswers,
} from '../../src/wizard/types.js'
import { collaborationModeFromAnswers } from '../../src/config/collaboration-mode-defaults.js'

// ── Type-shape guards (compile-time + runtime exhaustiveness) ────────────────

describe('CollaborationMode type', () => {
  it('accepts all three valid values', () => {
    const modes: CollaborationMode[] = ['trunk-solo', 'peer-review', 'gated-review']
    expect(modes).toHaveLength(3)
  })
})

describe('BranchingStrategy type', () => {
  it('accepts all three valid values', () => {
    const strategies: BranchingStrategy[] = [
      'trunk-direct',
      'github-flow',
      'github-flow-with-develop',
    ]
    expect(strategies).toHaveLength(3)
  })
})

describe('SoloMergeMode type', () => {
  it('accepts both valid values', () => {
    const modes: SoloMergeMode[] = ['direct', 'pr-ff']
    expect(modes).toHaveLength(2)
  })
})

describe('WorktreeAutoMode type', () => {
  it('accepts all three valid values', () => {
    const modes: WorktreeAutoMode[] = ['always', 'optional', 'never']
    expect(modes).toHaveLength(3)
  })
})

// ── WizardAnswers shape ──────────────────────────────────────────────────────

describe('WizardAnswers.collaborationMode', () => {
  it('is optional and accepts trunk-solo', () => {
    const a: Partial<WizardAnswers> = { collaborationMode: 'trunk-solo' }
    expect(a.collaborationMode).toBe('trunk-solo')
  })

  it('is optional — absent is fine', () => {
    const a: Partial<WizardAnswers> = {}
    expect(a.collaborationMode).toBeUndefined()
  })
})

// ── ProjectConfig shape ──────────────────────────────────────────────────────

describe('ProjectConfig.collaborationMode', () => {
  it('accepts gated-review on a valid config shape', () => {
    const partial: Partial<ProjectConfig> = { collaborationMode: 'gated-review' }
    expect(partial.collaborationMode).toBe('gated-review')
  })
})

describe('ProjectConfig.branchingStrategy', () => {
  it('accepts github-flow-with-develop', () => {
    const partial: Partial<ProjectConfig> = { branchingStrategy: 'github-flow-with-develop' }
    expect(partial.branchingStrategy).toBe('github-flow-with-develop')
  })
})

describe('ProjectConfig.tasks', () => {
  it('accepts worktree: always', () => {
    const partial: Partial<ProjectConfig> = { tasks: { worktree: 'always' } }
    expect(partial.tasks?.worktree).toBe('always')
  })
})

describe('ProjectConfig.solo', () => {
  it('accepts mergeMode: direct', () => {
    const partial: Partial<ProjectConfig> = { solo: { mergeMode: 'direct' } }
    expect(partial.solo?.mergeMode).toBe('direct')
  })
})

// ── soloDevMode backward-compat alias ───────────────────────────────────────

describe('collaborationModeFromAnswers — backward-compat alias', () => {
  it('soloDevMode: true → trunk-solo', () => {
    const answers: Partial<WizardAnswers> = { soloDevMode: true }
    expect(collaborationModeFromAnswers(answers)).toBe('trunk-solo')
  })

  it('soloDevMode: false → peer-review (default)', () => {
    const answers: Partial<WizardAnswers> = { soloDevMode: false }
    expect(collaborationModeFromAnswers(answers)).toBe('peer-review')
  })

  it('soloDevMode absent → peer-review (default)', () => {
    const answers: Partial<WizardAnswers> = {}
    expect(collaborationModeFromAnswers(answers)).toBe('peer-review')
  })

  it('explicit collaborationMode overrides soloDevMode', () => {
    const answers: Partial<WizardAnswers> = {
      soloDevMode: true,
      collaborationMode: 'gated-review',
    }
    expect(collaborationModeFromAnswers(answers)).toBe('gated-review')
  })

  it('peer-review → peer-review', () => {
    const answers: Partial<WizardAnswers> = { collaborationMode: 'peer-review' }
    expect(collaborationModeFromAnswers(answers)).toBe('peer-review')
  })

  it('gated-review → gated-review', () => {
    const answers: Partial<WizardAnswers> = { collaborationMode: 'gated-review' }
    expect(collaborationModeFromAnswers(answers)).toBe('gated-review')
  })
})
