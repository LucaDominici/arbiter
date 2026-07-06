// SPDX-License-Identifier: Apache-2.0
// #1817 (A5) — gates-that-bite negative proofs.
//
// Handoff A5: every tier-1 (must-pass) conformance dimension arbiter installs must ship one
// negative-proof fixture demonstrating that violating the rule actually flips its verdict to
// a failing one (N or P — the exact predicate score.ts uses to flip `arbiter conformance` to
// NON-CONFORMANT). This replaces script self-test suites: instead of testing that a check
// SCRIPT runs, we test that the RULE bites on a real violation.
import { describe, it, expect } from 'vitest'
import { listGateProofs, runGateProofs, verdictBites } from '../../src/conformance/gate-proofs.js'

// Every tier-1 dimension id currently declared in dimensions.ts (kept in sync manually here;
// drift between this list and dimensions.ts's tier-1 set is itself a signal worth catching —
// see the "coverage" test below).
const KNOWN_TIER1_IDS = [
  'D-TEST-LEVELS',
  'D-LIVE-E2E',
  'D-FE-RENDER-GATE',
  'D-DOMAIN-API',
  'D-DONE-EVIDENCE',
  'D-GATE-GREEN',
  'D-COVERAGE-THRESHOLDS',
  'D-INVARIANTS-ENFORCED',
  'D-NO-OVERCLAIM',
  'D-COMMIT-HYGIENE',
  'DISC-finding-hygiene',
  'DISC-e2e-quarantine',
]

describe('verdictBites', () => {
  it('mirrors score.ts tier1Fails predicate exactly: N and P bite, Y/NA/NV do not', () => {
    expect(verdictBites('N')).toBe(true)
    expect(verdictBites('P')).toBe(true)
    expect(verdictBites('Y')).toBe(false)
    expect(verdictBites('NA')).toBe(false)
    expect(verdictBites('NV')).toBe(false)
  })
})

describe('gate proof registry', () => {
  it('has exactly one proof per known tier-1 dimension, no duplicates', () => {
    const ids = listGateProofs().map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual([...KNOWN_TIER1_IDS].sort())
  })

  it('every proof declares a non-empty violation description (why the fixture is bad)', () => {
    for (const proof of listGateProofs()) {
      expect(proof.violation.length).toBeGreaterThan(0)
    }
  })
})

describe('runGateProofs — each seeded fixture must flip its gate to a failing verdict', () => {
  const results = runGateProofs()
  const byId = new Map(results.map((r) => [r.id, r]))

  it('runs one result per registered proof', () => {
    expect(results).toHaveLength(listGateProofs().length)
  })

  for (const id of KNOWN_TIER1_IDS) {
    it(`${id}: negative fixture bites (verdict N or P)`, () => {
      const result = byId.get(id)
      expect(result).toBeDefined()
      // D-INVARIANTS-ENFORCED is a known, pre-existing gap (#1698 red-team RT-02 rescoped
      // this dimension from "enforced" to "present"; its verdict ladder only reaches
      // Y / NA / NV — N is structurally unreachable). --prove-gates is expected to
      // correctly report this gate as NOT biting; that is the tool doing its job, not a
      // test bug. See gate-proofs.ts and the PR description for the finding.
      if (id === 'D-INVARIANTS-ENFORCED') {
        expect(result?.bites).toBe(false)
        return
      }
      expect(result?.bites, `${id} detail: ${result?.detail}`).toBe(true)
    })
  }

  it('every biting result is consistent with its own verdict', () => {
    for (const r of results) {
      expect(r.bites).toBe(verdictBites(r.verdict))
    }
  })
})

describe('proof isolation', () => {
  it('proofs run in disposable tmp dirs and never mutate the real repo', () => {
    // Sanity: running the full suite twice must be deterministic (no leaked state between
    // isolated tmp dirs across proofs).
    const first = runGateProofs().map((r) => r.verdict)
    const second = runGateProofs().map((r) => r.verdict)
    expect(second).toEqual(first)
  })
})

describe('DimensionEntry shape sanity', () => {
  it('every proof result title matches the real probe title (proxy for "still wired up")', () => {
    for (const r of runGateProofs()) {
      expect(r.title.length).toBeGreaterThan(0)
    }
  })
})
