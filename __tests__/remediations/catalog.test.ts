// SPDX-License-Identifier: Apache-2.0
// #1422 — close-gold-gap remediation catalog + handler dispatch (RED→GREEN).
//
// These tests pin the STRUCTURAL anti-fake-green invariants (red-team amendments, BLOCKING):
//   - deterministic catalog lookup per (id,type) returns a recipe citing SSOT + evidence
//   - every manual-typed check → a process playbook with NO code recipe
//   - a scaffold-only doc-set recipe is verdict P (presence ≠ closure), never Y
//   - NO suppression step (no --no-verify / skip / ignore / eslint-disable)
//   - NO marker-stuffing (no step whose sole action writes the matched pattern literal)
import { describe, it, expect } from 'vitest'
import { loadCatalog, validateCatalog } from '../../src/remediations/catalog.js'
import { planRemediation } from '../../src/remediations/handlers/index.js'
import type { RemediationGap } from '../../src/remediations/types.js'

const docGap: RemediationGap = {
  id: 'GA-DOC-03',
  dimension: 'D-DOCS',
  title: 'Security policy present',
  type: 'file_exists',
  verdict: 'N',
  anchor: null,
  evidence: { file: 'SECURITY.md', detail: 'missing' },
}

const testGap: RemediationGap = {
  id: 'GA-COV-01',
  dimension: 'D-COVERAGE',
  title: 'Line coverage meets the bar',
  type: 'value',
  verdict: 'N',
  anchor: 'INV-25',
  evidence: { file: 'coverage/coverage-summary.json', detail: '70 !gte 80' },
}

const configGap: RemediationGap = {
  id: 'GA-EFF-03',
  dimension: 'D-EFFECTIVENESS',
  title: 'Integration test level actually runs (declared script)',
  type: 'file_contains',
  verdict: 'N',
  anchor: 'INV-124',
  evidence: { file: 'package.json', detail: 'pattern not found: "test:integration"' },
}

const manualGap: RemediationGap = {
  id: 'GA-SUP-02',
  dimension: 'D-SUPPLY-CHAIN',
  title: 'Supply-chain attestation is human-verified on each release',
  type: 'manual',
  verdict: 'N',
  anchor: 'INV-95',
  evidence: null,
}

const SUPPRESSION = /--no-verify|\bskip\b|\bignore\b|eslint-disable|--no-gate/i

describe('loadCatalog (#1422)', () => {
  it('loads + validates the shipped playbook-catalog.json', () => {
    const cat = loadCatalog()
    expect(cat.version).toBeTruthy()
    expect(cat.byType.file_exists).toBeTruthy()
    expect(cat.byType.manual).toBeTruthy()
  })

  it('covers every engine check type', () => {
    const cat = loadCatalog()
    for (const t of ['file_exists', 'file_contains', 'count_matches', 'value', 'manual'] as const) {
      expect(cat.byType[t], `missing byType.${t}`).toBeTruthy()
    }
  })

  it('every manual-typed entry is process kind with NO code (expectedVerdict NV)', () => {
    const cat = loadCatalog()
    const manualEntries = [
      cat.byType.manual,
      ...Object.values(cat.overrides).filter((e) => e.type === 'manual'),
    ]
    for (const e of manualEntries) {
      expect(e.kind).toBe('process')
      expect(e.expectedVerdict).toBe('NV')
    }
  })

  it('no doc-set entry claims Y from presence alone (scaffold ⇒ P)', () => {
    const cat = loadCatalog()
    const docEntries = Object.values(cat.byType)
      .concat(Object.values(cat.overrides))
      .filter((e) => e.kind === 'doc-set')
    for (const e of docEntries) {
      expect(e.expectedVerdict).not.toBe('Y')
    }
  })

  it('validateCatalog rejects a manual entry that carries a code kind', () => {
    expect(() =>
      validateCatalog({
        version: '1',
        byType: {
          file_exists: {
            type: 'file_exists',
            kind: 'doc-set',
            expectedVerdict: 'P',
            ssot: ['x'],
            rationale: 'r',
          },
          file_contains: {
            type: 'file_contains',
            kind: 'config',
            expectedVerdict: 'Y',
            ssot: ['x'],
            rationale: 'r',
          },
          count_matches: {
            type: 'count_matches',
            kind: 'config',
            expectedVerdict: 'Y',
            ssot: ['x'],
            rationale: 'r',
          },
          value: {
            type: 'value',
            kind: 'config',
            expectedVerdict: 'Y',
            ssot: ['x'],
            rationale: 'r',
          },
          // INVALID: manual mapped to a code kind
          manual: {
            type: 'manual',
            kind: 'config',
            expectedVerdict: 'NV',
            ssot: ['x'],
            rationale: 'r',
          },
        },
        overrides: {},
      }),
    ).toThrow()
  })
})

describe('planRemediation dispatch (#1422)', () => {
  it('is deterministic — same gap ⇒ identical plan', () => {
    const a = planRemediation(docGap)
    const b = planRemediation(docGap)
    expect(a).toEqual(b)
  })

  it('every plan cites at least one SSOT + the gap evidence', () => {
    for (const gap of [docGap, testGap, configGap, manualGap]) {
      const plan = planRemediation(gap)
      expect(plan.ssot.length, `${gap.id} cites no SSOT`).toBeGreaterThan(0)
      expect(plan.evidence.length, `${gap.id} has no evidence`).toBeGreaterThan(0)
      expect(plan.steps.length, `${gap.id} has no steps`).toBeGreaterThan(0)
    }
  })

  it('manual gap ⇒ process playbook with NO code recipe (NV)', () => {
    const plan = planRemediation(manualGap)
    expect(plan.kind).toBe('process')
    expect(plan.code).toBe(false)
    expect(plan.expectedVerdict).toBe('NV')
    expect(plan.steps.every((s) => s.delegateCommand === undefined)).toBe(true)
  })

  it('doc-set scaffold gap ⇒ P, never Y (presence ≠ closure)', () => {
    const plan = planRemediation(docGap)
    expect(plan.kind).toBe('doc-set')
    expect(plan.expectedVerdict).toBe('P')
    expect(plan.expectedVerdict).not.toBe('Y')
    // It DELEGATES to check-doc-set --generate (scaffold) but also chains a fill step.
    const cmds = plan.steps.map((s) => s.delegateCommand ?? '').join(' ')
    expect(cmds).toContain('check-doc-set')
    expect(cmds).toContain('--generate')
    // There MUST be a human "fill in real content" step beyond the scaffold.
    expect(plan.steps.length).toBeGreaterThan(1)
  })

  it('test gap ⇒ delegates to the tdd skill', () => {
    const plan = planRemediation(testGap)
    expect(plan.kind).toBe('test')
    expect(plan.steps.some((s) => s.delegateSkill === 'tdd')).toBe(true)
  })

  it('config gap ⇒ config kind keyed off the evidence', () => {
    const plan = planRemediation(configGap)
    expect(plan.kind).toBe('config')
    expect(plan.code).toBe(true)
  })

  it('NO plan contains a suppression step', () => {
    for (const gap of [docGap, testGap, configGap, manualGap]) {
      const plan = planRemediation(gap)
      for (const s of plan.steps) {
        const blob = `${s.action} ${s.delegateCommand ?? ''}`
        expect(SUPPRESSION.test(blob), `${gap.id} step suppresses: ${blob}`).toBe(false)
      }
    }
  })

  it('NO plan marker-stuffs the matched pattern as its sole action', () => {
    // file_contains evidence detail is "pattern not found: <literal>". A fake-green recipe would
    // just echo that literal into the file. Assert no step's action is ONLY that literal write.
    const plan = planRemediation(configGap)
    const literal = '"test:integration"'
    for (const s of plan.steps) {
      const onlyLiteral =
        s.action.trim() === literal ||
        s.action.trim() === `echo ${literal}` ||
        /^add ['"]?.{0,4}$/.test(s.action.trim())
      expect(onlyLiteral).toBe(false)
    }
  })
})
