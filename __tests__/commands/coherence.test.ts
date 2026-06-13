// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests — Phase B coherence validation layer (micro-cycle 4)
 * Validates the L4+trunk-solo rejection rule and ⚠️ cell warnings.
 * Non-regression guard for #1080.
 */
import { describe, it, expect } from 'vitest'
import type {
  Archetype,
  CollaborationMode,
  GovernanceLevel,
  Language,
} from '../../src/wizard/types.js'
import {
  validateCollaborationCoherence,
  validateAutonomyCoherence,
  validateLanguageArchetypeCoherence,
  type CoherenceResult,
} from '../../src/commands/wizard/coherence.js'

// ── L4 + trunk-solo rejection ────────────────────────────────────────────────

describe('validateCollaborationCoherence — L4 + trunk-solo (CRITICAL)', () => {
  it('rejects L4 + trunk-solo with CRITICAL severity', () => {
    const result = validateCollaborationCoherence('trunk-solo', 'L4')
    expect(result.valid).toBe(false)
    expect(result.severity).toBe('CRITICAL')
    expect(result.message).toContain('L4')
    expect(result.message).toContain('trunk-solo')
  })

  it('CRITICAL result includes a remediation hint', () => {
    const result = validateCollaborationCoherence('trunk-solo', 'L4')
    expect(result.remediation).toBeTruthy()
    expect(result.remediation).toMatch(/peer-review|gated-review|L3/i)
  })
})

// ── ⚠️ warning cells ─────────────────────────────────────────────────────────

describe('validateCollaborationCoherence — warning cells', () => {
  it('L3 + trunk-solo → valid but WARN (no human-approval gate active)', () => {
    const result = validateCollaborationCoherence('trunk-solo', 'L3')
    expect(result.valid).toBe(true)
    expect(result.severity).toBe('WARN')
    expect(result.message).toMatch(/human.?approval|no reviewer/i)
  })

  it('L1 + gated-review → valid but WARN (uncommon cell)', () => {
    const result = validateCollaborationCoherence('gated-review', 'L1')
    expect(result.valid).toBe(true)
    expect(result.severity).toBe('WARN')
  })

  it('L4 + peer-review → valid but WARN (pr-ff mandatory override)', () => {
    const result = validateCollaborationCoherence('peer-review', 'L4')
    expect(result.valid).toBe(true)
    expect(result.severity).toBe('WARN')
    expect(result.message).toMatch(/pr-ff|merge mode/i)
  })
})

// ── ✅ ideal cells ────────────────────────────────────────────────────────────

describe('validateCollaborationCoherence — ideal cells (no warnings)', () => {
  const idealCells: Array<[CollaborationMode, GovernanceLevel]> = [
    ['trunk-solo', 'L1'],
    ['trunk-solo', 'L2'],
    ['peer-review', 'L1'],
    ['peer-review', 'L2'],
    ['peer-review', 'L3'],
    ['gated-review', 'L2'],
    ['gated-review', 'L3'],
    ['gated-review', 'L4'],
  ]

  for (const [mode, level] of idealCells) {
    it(`${mode} + ${level} → valid, no warning`, () => {
      const result = validateCollaborationCoherence(mode, level)
      expect(result.valid, `expected valid for ${mode}+${level}`).toBe(true)
      expect(result.severity, `expected OK for ${mode}+${level}`).toBe('OK')
    })
  }
})

// ── full 4×3 matrix exhaustiveness ───────────────────────────────────────────

describe('validateCollaborationCoherence — complete 12-cell matrix', () => {
  const ALL_MODES: CollaborationMode[] = ['trunk-solo', 'peer-review', 'gated-review']
  const ALL_LEVELS: GovernanceLevel[] = ['L1', 'L2', 'L3', 'L4']

  it('returns a CoherenceResult for every (mode × level) cell', () => {
    for (const mode of ALL_MODES) {
      for (const level of ALL_LEVELS) {
        const result = validateCollaborationCoherence(mode, level)
        expect(result, `${mode}+${level}`).toBeDefined()
        expect(['OK', 'WARN', 'CRITICAL'], `${mode}+${level}`).toContain(result.severity)
        expect(typeof result.valid, `${mode}+${level}`).toBe('boolean')
      }
    }
  })

  it('only L4+trunk-solo produces CRITICAL', () => {
    for (const mode of ALL_MODES) {
      for (const level of ALL_LEVELS) {
        const result = validateCollaborationCoherence(mode, level)
        if (result.severity === 'CRITICAL') {
          expect(mode).toBe('trunk-solo')
          expect(level).toBe('L4')
        }
      }
    }
  })

  it('CRITICAL cells are always invalid', () => {
    for (const mode of ALL_MODES) {
      for (const level of ALL_LEVELS) {
        const result = validateCollaborationCoherence(mode, level)
        if (result.severity === 'CRITICAL') {
          expect(result.valid).toBe(false)
        }
      }
    }
  })

  it('OK and WARN cells are always valid', () => {
    for (const mode of ALL_MODES) {
      for (const level of ALL_LEVELS) {
        const result = validateCollaborationCoherence(mode, level)
        if (result.severity === 'OK' || result.severity === 'WARN') {
          expect(result.valid).toBe(true)
        }
      }
    }
  })
})

// ── CoherenceResult shape ────────────────────────────────────────────────────

describe('CoherenceResult interface', () => {
  it('has required fields valid, severity, message', () => {
    const result: CoherenceResult = validateCollaborationCoherence('peer-review', 'L2')
    expect(typeof result.valid).toBe('boolean')
    expect(typeof result.severity).toBe('string')
    expect(typeof result.message).toBe('string')
  })

  it('remediation is present on CRITICAL results and absent on OK results', () => {
    const critical = validateCollaborationCoherence('trunk-solo', 'L4')
    expect(critical.remediation).toBeTruthy()

    const ok = validateCollaborationCoherence('peer-review', 'L2')
    expect(ok.remediation).toBeUndefined()
  })
})

// ── #1292: validateAutonomyCoherence (ADR-093 §4) ────────────────────────────

describe('validateAutonomyCoherence — L3 without CI (CRITICAL)', () => {
  it('rejects autonomy L3 when no CI is present', () => {
    const result = validateAutonomyCoherence('L3', 'L2', false)
    expect(result.valid).toBe(false)
    expect(result.severity).toBe('CRITICAL')
    expect(result.message).toMatch(/CI/)
    expect(result.remediation).toBeTruthy()
  })

  it('accepts autonomy L3 when CI is present (governance below L4)', () => {
    const result = validateAutonomyCoherence('L3', 'L3', true)
    expect(result.valid).toBe(true)
    expect(result.severity).toBe('OK')
  })
})

describe('validateAutonomyCoherence — governance L4 + autonomy L3 (CRITICAL)', () => {
  it('rejects L4 governance with L3 autonomy even when CI is present', () => {
    const result = validateAutonomyCoherence('L3', 'L4', true)
    expect(result.valid).toBe(false)
    expect(result.severity).toBe('CRITICAL')
    expect(result.message).toMatch(/human/i)
    expect(result.remediation).toBeTruthy()
  })

  it('accepts L4 governance with L2 autonomy — exactly the ADR boundary, no scope-creep WARN', () => {
    const result = validateAutonomyCoherence('L2', 'L4', true)
    expect(result.valid).toBe(true)
    expect(result.severity).toBe('OK')
    expect(result.message).toBe('')
  })
})

describe('validateAutonomyCoherence — exhaustive OK cells', () => {
  const governanceLevels: GovernanceLevel[] = ['L1', 'L2', 'L3', 'L4']

  it('autonomy L0–L2 is OK for every governance level regardless of CI', () => {
    for (const autonomy of ['L0', 'L1', 'L2']) {
      for (const level of governanceLevels) {
        for (const hasCi of [true, false]) {
          const result = validateAutonomyCoherence(autonomy, level, hasCi)
          expect(result.valid, `${autonomy} @ ${level} hasCi=${hasCi}`).toBe(true)
          expect(result.severity, `${autonomy} @ ${level} hasCi=${hasCi}`).toBe('OK')
        }
      }
    }
  })

  it('autonomy L3 with CI is OK at governance L1–L3', () => {
    for (const level of ['L1', 'L2', 'L3'] as GovernanceLevel[]) {
      const result = validateAutonomyCoherence('L3', level, true)
      expect(result.severity, `L3 @ ${level}`).toBe('OK')
    }
  })
})

describe('validateAutonomyCoherence — unrecognized literal (WARN)', () => {
  it('warns on a lowercase literal that bypassed validateConfig (raw JSON.parse path)', () => {
    const result = validateAutonomyCoherence('l3', 'L2', true)
    expect(result.valid).toBe(true)
    expect(result.severity).toBe('WARN')
    expect(result.message).toMatch(/arbiter update/)
  })

  it('warns on an out-of-range literal', () => {
    const result = validateAutonomyCoherence('L9', 'L2', true)
    expect(result.severity).toBe('WARN')
  })
})

// ── #1347: language × archetype coherence (WARN | OK) ────────────────────────
//
// Conservative advisory axis: a handful of language×archetype pairs the framework
// cannot meaningfully scaffold (e.g. go + frontend-spa, python + embedded) surface
// a WARN. Never CRITICAL (no hard block without product sign-off). unknown/multi
// language and undefined archetype are always OK (no false WARN).

describe('validateLanguageArchetypeCoherence — incompatible pairs (WARN)', () => {
  const incompatible: Array<[Language, Archetype]> = [
    ['go', 'frontend-spa'],
    ['python', 'embedded'],
    ['java', 'frontend-spa'],
  ]
  for (const [language, archetype] of incompatible) {
    it(`${language} + ${archetype} → valid but WARN`, () => {
      const r = validateLanguageArchetypeCoherence(language, archetype)
      expect(r.valid, `${language}+${archetype}`).toBe(true)
      expect(r.severity, `${language}+${archetype}`).toBe('WARN')
      expect(r.message).toMatch(new RegExp(language))
      expect(r.message).toMatch(new RegExp(archetype))
    })
  }

  it('never returns CRITICAL (no hard block on this axis)', () => {
    for (const [language, archetype] of incompatible) {
      const r = validateLanguageArchetypeCoherence(language, archetype)
      expect(r.severity, `${language}+${archetype}`).not.toBe('CRITICAL')
    }
  })
})

describe('validateLanguageArchetypeCoherence — compatible / unknown (OK)', () => {
  const ok: Array<[Language, Archetype | undefined]> = [
    ['typescript', 'frontend-spa'],
    ['go', 'backend-web-db'],
    ['python', 'data-pipeline'],
    ['rust', 'embedded'],
    ['unknown', 'frontend-spa'],
    ['multi', 'embedded'],
    ['go', undefined],
  ]
  for (const [language, archetype] of ok) {
    it(`${language} + ${String(archetype)} → OK`, () => {
      const r = validateLanguageArchetypeCoherence(language, archetype)
      expect(r.valid, `${language}+${String(archetype)}`).toBe(true)
      expect(r.severity, `${language}+${String(archetype)}`).toBe('OK')
    })
  }
})
