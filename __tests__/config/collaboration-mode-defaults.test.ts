// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests — Phase B defaults table layer (micro-cycle 2)
 * Validates the (collaborationMode × archetype × governanceLevel) → pipelineStyle
 * lookup table and branchingStrategy defaults. Non-regression guard for #1080.
 */
import { describe, it, expect } from 'vitest'
import type { CollaborationMode, GovernanceLevel } from '../../src/wizard/types.js'
import {
  resolvePipelineStyle,
  resolveDefaultBranchingStrategy,
  resolveDefaultWorktreeMode,
  resolveDefaultMergeMode,
  collaborationModeFromAnswers,
} from '../../src/config/collaboration-mode-defaults.js'

// ── resolvePipelineStyle ─────────────────────────────────────────────────────

describe('resolvePipelineStyle', () => {
  describe('trunk-solo', () => {
    it('trunk-solo + L1 → starter', () => {
      expect(resolvePipelineStyle('trunk-solo', 'L1')).toBe('starter')
    })

    it('trunk-solo + L2 → starter', () => {
      expect(resolvePipelineStyle('trunk-solo', 'L2')).toBe('starter')
    })

    it('trunk-solo + L3 → standard', () => {
      expect(resolvePipelineStyle('trunk-solo', 'L3')).toBe('standard')
    })

    it('trunk-solo + L4 → standard', () => {
      expect(resolvePipelineStyle('trunk-solo', 'L4')).toBe('standard')
    })
  })

  describe('peer-review', () => {
    it('peer-review + L1 → starter', () => {
      expect(resolvePipelineStyle('peer-review', 'L1')).toBe('starter')
    })

    it('peer-review + L2 → standard', () => {
      expect(resolvePipelineStyle('peer-review', 'L2')).toBe('standard')
    })

    it('peer-review + L3 → standard', () => {
      expect(resolvePipelineStyle('peer-review', 'L3')).toBe('standard')
    })

    it('peer-review + L4 → standard', () => {
      expect(resolvePipelineStyle('peer-review', 'L4')).toBe('standard')
    })
  })

  describe('gated-review', () => {
    it('gated-review + L1 → standard', () => {
      expect(resolvePipelineStyle('gated-review', 'L1')).toBe('standard')
    })

    it('gated-review + L2 → standard', () => {
      expect(resolvePipelineStyle('gated-review', 'L2')).toBe('standard')
    })

    it('gated-review + L3 → industrial', () => {
      expect(resolvePipelineStyle('gated-review', 'L3')).toBe('industrial')
    })

    it('gated-review + L4 → industrial', () => {
      expect(resolvePipelineStyle('gated-review', 'L4')).toBe('industrial')
    })
  })
})

// ── resolveDefaultBranchingStrategy ─────────────────────────────────────────

describe('resolveDefaultBranchingStrategy', () => {
  it('trunk-solo → trunk-direct', () => {
    expect(resolveDefaultBranchingStrategy('trunk-solo')).toBe('trunk-direct')
  })

  it('peer-review → github-flow', () => {
    expect(resolveDefaultBranchingStrategy('peer-review')).toBe('github-flow')
  })

  it('gated-review → github-flow', () => {
    expect(resolveDefaultBranchingStrategy('gated-review')).toBe('github-flow')
  })
})

// ── resolveDefaultWorktreeMode ───────────────────────────────────────────────

describe('resolveDefaultWorktreeMode', () => {
  it('trunk-solo → optional', () => {
    expect(resolveDefaultWorktreeMode('trunk-solo')).toBe('optional')
  })

  it('peer-review → always', () => {
    expect(resolveDefaultWorktreeMode('peer-review')).toBe('always')
  })

  it('gated-review → always', () => {
    expect(resolveDefaultWorktreeMode('gated-review')).toBe('always')
  })
})

// ── resolveDefaultMergeMode ──────────────────────────────────────────────────

describe('resolveDefaultMergeMode', () => {
  it('trunk-solo → direct', () => {
    expect(resolveDefaultMergeMode('trunk-solo')).toBe('direct')
  })

  it('peer-review → pr-ff', () => {
    expect(resolveDefaultMergeMode('peer-review')).toBe('pr-ff')
  })

  it('gated-review → pr-ff', () => {
    expect(resolveDefaultMergeMode('gated-review')).toBe('pr-ff')
  })
})

// ── collaborationModeFromAnswers — exhaustive alias table ────────────────────

describe('collaborationModeFromAnswers (re-exported from defaults)', () => {
  const ALL_MODES: CollaborationMode[] = ['trunk-solo', 'peer-review', 'gated-review']
  const ALL_LEVELS: GovernanceLevel[] = ['L1', 'L2', 'L3', 'L4']

  it('returns a valid CollaborationMode for any input', () => {
    for (const mode of ALL_MODES) {
      const result = collaborationModeFromAnswers({ collaborationMode: mode })
      expect(ALL_MODES).toContain(result)
    }
  })

  it('all (mode × level) cells produce a valid pipelineStyle', () => {
    const validStyles = ['starter', 'standard', 'industrial']
    for (const mode of ALL_MODES) {
      for (const level of ALL_LEVELS) {
        const style = resolvePipelineStyle(mode, level)
        expect(validStyles, `mode=${mode} level=${level}`).toContain(style)
      }
    }
  })
})
