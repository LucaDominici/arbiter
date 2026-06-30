// SPDX-License-Identifier: Apache-2.0
// probe-writer-audit.test.ts — tests for the full-matrix probe↔writer audit (#1707).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { auditConformanceResult, CELLS } from '../../scripts/probe-writer-audit.mjs'

const CELL = { archetype: 'library', level: 'L2', language: 'typescript' }

function dims(entries: Array<[string, string]>) {
  return entries.map(([id, verdict]) => ({ id, verdict }))
}

describe('probe-writer-audit — auditConformanceResult (unit, #1707)', () => {
  it('passes when every dim is Y/NA/NV (no spurious N)', () => {
    const res = auditConformanceResult(CELL, {
      status: 'ok',
      verdict: 'GOLD',
      dimensions: dims([
        ['D-TEST-LEVELS', 'Y'],
        ['D-INVARIANTS-ENFORCED', 'Y'],
        ['D-COMMIT-HYGIENE', 'Y'],
        ['D-GATE-GREEN', 'NV'],
        ['D-COVERAGE-THRESHOLDS', 'NV'],
        ['D-NO-OVERCLAIM', 'NV'],
        ['D-LIVE-E2E', 'NA'],
        ['D-FE-RENDER-GATE', 'NA'],
      ]),
    })
    expect(res.pass).toBe(true)
    expect(res.mismatches).toHaveLength(0)
  })

  it('fails on a spurious N for a generator-satisfied dim (probe≠writer)', () => {
    const res = auditConformanceResult(CELL, {
      status: 'fail',
      verdict: 'NON-CONFORMANT',
      dimensions: dims([
        ['D-TEST-LEVELS', 'Y'],
        ['D-COMMIT-HYGIENE', 'N'], // spurious — generator emits .githooks + commitlint
        ['D-GATE-GREEN', 'NV'],
      ]),
    })
    expect(res.pass).toBe(false)
    expect(res.mismatches.some((m) => m.includes('D-COMMIT-HYGIENE'))).toBe(true)
  })

  it('fails on a runtime dim scoring N instead of NV/NA (fresh-clone hole)', () => {
    const res = auditConformanceResult(CELL, {
      status: 'fail',
      verdict: 'NON-CONFORMANT',
      dimensions: dims([
        ['D-TEST-LEVELS', 'Y'],
        ['D-GATE-GREEN', 'N'], // spurious — runtime dim must be NV/NA on fresh clone
        ['D-NO-OVERCLAIM', 'NV'],
      ]),
    })
    expect(res.pass).toBe(false)
    expect(res.mismatches.some((m) => m.includes('D-GATE-GREEN'))).toBe(true)
  })

  it('D-DONE-EVIDENCE=N is the known absent→N asymmetry — NOT a mismatch', () => {
    const res = auditConformanceResult(CELL, {
      status: 'fail',
      verdict: 'NON-CONFORMANT',
      dimensions: dims([
        ['D-TEST-LEVELS', 'Y'],
        ['D-DONE-EVIDENCE', 'N'], // known asymmetry — fresh clone has no .last-done-evidence.json
        ['D-GATE-GREEN', 'NV'],
      ]),
    })
    expect(res.pass).toBe(true)
  })

  it('a NON-classified dim scoring N is NOT a mismatch (config does not prescribe it)', () => {
    // DOC-README / D-DOMAIN-API are NOT in the guard's GENERATOR_SATISFIED or
    // RUNTIME sets — a fresh-generated project may legitimately score N when the
    // config does not prescribe them (e.g. hasPublicApi=false). Flagging these
    // would confound probe≠writer with the separate minimal-init gap.
    const res = auditConformanceResult(CELL, {
      status: 'fail',
      verdict: 'NON-CONFORMANT',
      dimensions: dims([
        ['D-TEST-LEVELS', 'Y'],
        ['D-COMMIT-HYGIENE', 'Y'],
        ['DOC-CONTRIBUTING', 'Y'],
        ['D-GATE-GREEN', 'NV'],
        ['D-DONE-EVIDENCE', 'N'], // expected
        ['DOC-README', 'N'], // not classified — legit (generator doesn't emit by default)
        ['DOC-CHANGELOG', 'N'], // not classified — legit
        ['DOC-LICENSE', 'N'], // not classified — legit
        ['D-DOMAIN-API', 'N'], // not classified — legit (hasPublicApi=false)
      ]),
    })
    expect(res.pass).toBe(true)
    expect(res.mismatches).toHaveLength(0)
  })

  it('D-FE-RENDER-GATE=N is a mismatch (archetype-gated — must be Y or NA, never N)', () => {
    const res = auditConformanceResult(
      { archetype: 'frontend-spa', level: 'L2', language: 'typescript' },
      {
        status: 'fail',
        verdict: 'NON-CONFORMANT',
        dimensions: dims([
          ['D-TEST-LEVELS', 'Y'],
          ['D-FE-RENDER-GATE', 'N'], // archetype-gated — must be Y (FE) or NA (non-FE), never N
          ['D-GATE-GREEN', 'NV'],
        ]),
      },
    )
    expect(res.pass).toBe(false)
    expect(res.mismatches.some((m) => m.includes('D-FE-RENDER-GATE'))).toBe(true)
  })

  it('D-LIVE-E2E=N is a mismatch (archetype-gated — must be Y or NA, never N)', () => {
    const res = auditConformanceResult(
      { archetype: 'backend-web-db', level: 'L2', language: 'typescript' },
      {
        status: 'fail',
        verdict: 'NON-CONFORMANT',
        dimensions: dims([
          ['D-TEST-LEVELS', 'Y'],
          ['D-LIVE-E2E', 'N'], // archetype-gated — must be Y (service) or NA (non-service), never N
          ['D-GATE-GREEN', 'NV'],
        ]),
      },
    )
    expect(res.pass).toBe(false)
    expect(res.mismatches.some((m) => m.includes('D-LIVE-E2E'))).toBe(true)
  })

  it('status=skip is a mismatch (cell was not governed — arbiter init failed)', () => {
    const res = auditConformanceResult(CELL, { status: 'skip', verdict: 'SKIP', dimensions: [] })
    expect(res.pass).toBe(false)
    expect(res.mismatches[0]).toContain('skip')
  })

  it('empty dimensions is a mismatch', () => {
    const res = auditConformanceResult(CELL, { status: 'ok', verdict: 'GOLD', dimensions: [] })
    expect(res.pass).toBe(false)
    expect(res.mismatches[0]).toContain('no dimensions')
  })

  it('multiple spurious Ns are all reported', () => {
    const res = auditConformanceResult(CELL, {
      status: 'fail',
      verdict: 'NON-CONFORMANT',
      dimensions: dims([
        ['D-COMMIT-HYGIENE', 'N'],
        ['D-INVARIANTS-ENFORCED', 'N'],
        ['D-DONE-EVIDENCE', 'N'], // expected
        ['D-GATE-GREEN', 'NV'],
      ]),
    })
    expect(res.pass).toBe(false)
    expect(res.mismatches).toHaveLength(2)
    expect(res.mismatches.some((m) => m.includes('D-COMMIT-HYGIENE'))).toBe(true)
    expect(res.mismatches.some((m) => m.includes('D-INVARIANTS-ENFORCED'))).toBe(true)
    expect(res.mismatches.some((m) => m.includes('D-DONE-EVIDENCE'))).toBe(false)
  })
})

describe('probe-writer-audit — CELLS matrix (#1707)', () => {
  it('ships a representative archetype×level matrix', () => {
    expect(CELLS.length).toBeGreaterThanOrEqual(6)
    const archetypes = new Set(CELLS.map((c) => c.archetype))
    expect(archetypes.has('library')).toBe(true)
    expect(archetypes.has('backend-web-db')).toBe(true)
    expect(archetypes.has('frontend-spa')).toBe(true)
    const levels = new Set(CELLS.map((c) => c.level))
    expect(levels.has('L1')).toBe(true)
    expect(levels.has('L2')).toBe(true)
    expect(levels.has('L3')).toBe(true)
  })
})

describe('probe-writer-audit — CLI dry-run (#1707)', () => {
  it('--dry-run prints the plan and exits 0', () => {
    const res = spawnSync(
      'node',
      [join(process.cwd(), 'scripts', 'probe-writer-audit.mjs'), '--dry-run'],
      {
        encoding: 'utf-8',
      },
    )
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('DRY RUN')
    expect(res.stdout).toContain('D-DONE-EVIDENCE')
  })
})
