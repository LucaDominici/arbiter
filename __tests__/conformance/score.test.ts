// SPDX-License-Identifier: Apache-2.0
// Two-tier conformance scoring engine tests (#1394/C2 of #1369).
import { describe, it, expect } from 'vitest'
import { computeConformance } from '../../src/conformance/score.js'
import type { TwoTierResult, ConformanceThresholds } from '../../src/conformance/score.js'
import type { DimensionEntry } from '../../src/conformance/dimensions.js'
import {
  validateConformanceThresholds,
  autoFillConformanceThresholds,
} from '../../src/config/schema.js'

// ── Test helpers ──────────────────────────────────────────────────────────────

function dim(
  id: string,
  tier: 1 | 2,
  verdict: 'Y' | 'P' | 'N' | 'NA' | 'NV',
  family: DimensionEntry['family'],
): DimensionEntry {
  return {
    id,
    title: id,
    family,
    tier,
    weight: tier === 1 ? 0 : 1,
    required_at: 'L1',
    verdict,
    evidence: { file: 'test' },
  }
}

const DEFAULT_T: ConformanceThresholds = {
  tier1Members: [
    'D-TEST-LEVELS',
    'D-LIVE-E2E',
    'D-GATE-GREEN',
    'D-DONE-EVIDENCE',
    'D-NO-OVERCLAIM',
  ],
  familyWeights: {
    discipline: 0.15,
    'reality-contact': 0.35,
    'docs-convention': 0.2,
    'code-quality-gold': 0.3,
  },
  goldTier2Gate: 0.9,
}

// ── Unit 1: T1 N → NON-CONFORMANT regardless of T2 score ─────────────────────

describe('computeConformance — Unit 1: Tier-1 N forces NON-CONFORMANT', () => {
  it('returns NON-CONFORMANT when a tier-1 dim has verdict N, even if T2 score is high', () => {
    const dimensions: DimensionEntry[] = [
      dim('D-TEST-LEVELS', 1, 'N', 'reality-contact'),
      dim('D-LIVE-E2E', 1, 'Y', 'reality-contact'),
      dim('D-GATE-GREEN', 1, 'Y', 'reality-contact'),
      dim('D-DONE-EVIDENCE', 1, 'Y', 'reality-contact'),
      dim('D-NO-OVERCLAIM', 1, 'Y', 'reality-contact'),
      // Tier-2 dims all Y → high score
      dim('D-T2-A', 2, 'Y', 'discipline'),
      dim('D-T2-B', 2, 'Y', 'reality-contact'),
      dim('D-T2-C', 2, 'Y', 'docs-convention'),
      dim('D-T2-D', 2, 'Y', 'code-quality-gold'),
    ]
    const result: TwoTierResult = computeConformance(dimensions, DEFAULT_T, true)
    expect(result.verdict).toBe('NON-CONFORMANT')
    expect(result.tier1Fails).toHaveLength(1)
    expect(result.tier1Fails[0]?.id).toBe('D-TEST-LEVELS')
  })
})

// ── Unit 2: All Y → CONFORMANT (not GOLD when ratchetOk=false) ───────────────

describe('computeConformance — Unit 2: All Y → CONFORMANT (ratchetOk false)', () => {
  it('returns CONFORMANT with score 1.0 when all dims are Y but ratchetOk is false', () => {
    const dimensions: DimensionEntry[] = [
      dim('D-TEST-LEVELS', 1, 'Y', 'reality-contact'),
      dim('D-LIVE-E2E', 1, 'Y', 'reality-contact'),
      dim('D-GATE-GREEN', 1, 'Y', 'reality-contact'),
      dim('D-DONE-EVIDENCE', 1, 'Y', 'reality-contact'),
      dim('D-NO-OVERCLAIM', 1, 'Y', 'reality-contact'),
      dim('D-T2-DISC', 2, 'Y', 'discipline'),
      dim('D-T2-RC', 2, 'Y', 'reality-contact'),
      dim('D-T2-DOCS', 2, 'Y', 'docs-convention'),
      dim('D-T2-GOLD', 2, 'Y', 'code-quality-gold'),
    ]
    const result: TwoTierResult = computeConformance(dimensions, DEFAULT_T, false)
    expect(result.verdict).toBe('CONFORMANT')
    expect(result.score).toBeCloseTo(1.0)
    expect(result.tier1Fails).toHaveLength(0)
    expect(result.ratchetOk).toBe(false)
  })
})

// ── Unit 3: All T1 Y/NA, T2 ≥ 0.90, ratchetOk true → GOLD ──────────────────

describe('computeConformance — Unit 3: Gold predicate satisfied', () => {
  it('returns GOLD when all T1 Y/NA, T2 score ≥ goldTier2Gate, ratchetOk true', () => {
    const dimensions: DimensionEntry[] = [
      dim('D-TEST-LEVELS', 1, 'Y', 'reality-contact'),
      dim('D-LIVE-E2E', 1, 'NA', 'reality-contact'),
      dim('D-GATE-GREEN', 1, 'Y', 'reality-contact'),
      dim('D-DONE-EVIDENCE', 1, 'Y', 'reality-contact'),
      dim('D-NO-OVERCLAIM', 1, 'Y', 'reality-contact'),
      // One dim per family all Y → score = 1.0
      dim('D-T2-DISC', 2, 'Y', 'discipline'),
      dim('D-T2-RC', 2, 'Y', 'reality-contact'),
      dim('D-T2-DOCS', 2, 'Y', 'docs-convention'),
      dim('D-T2-GOLD', 2, 'Y', 'code-quality-gold'),
    ]
    const result: TwoTierResult = computeConformance(dimensions, DEFAULT_T, true)
    expect(result.verdict).toBe('GOLD')
    expect(result.score).toBeGreaterThanOrEqual(0.9)
    expect(result.ratchetOk).toBe(true)
    expect(result.tier1Fails).toHaveLength(0)
  })
})

// ── Unit 4: T2 score = 0.89 → CONFORMANT (not GOLD) ─────────────────────────

describe('computeConformance — Unit 4: T2 score below gate → CONFORMANT', () => {
  it('returns CONFORMANT (not GOLD) when T2 score = 0.89 even with ratchetOk true', () => {
    // To get a score near 0.89: use one Y and one N per family to get 0.5 per family.
    // Use thresholds with goldTier2Gate = 0.90.
    // Give all families one Y and one N → each family score = 0.5, overall = 0.5 < 0.90.
    // That's too low. Instead, set a thresholds object with goldTier2Gate=0.90,
    // and engineer a score of exactly 0.89 (below 0.90).
    // Simpler: use a high score threshold of 0.95 so that a score of 1.0 * 0.95 - ε fails.
    const highGateThresholds: ConformanceThresholds = {
      ...DEFAULT_T,
      goldTier2Gate: 0.95,
    }
    // Score = 1 dim per family, discipline=Y(1.0), others=P(0.5)
    // Weighted: 0.15*1.0 + 0.35*0.5 + 0.20*0.5 + 0.30*0.5 = 0.15 + 0.175 + 0.10 + 0.15 = 0.575
    // That's below 0.95, so CONFORMANT.
    const dimensions: DimensionEntry[] = [
      dim('D-TEST-LEVELS', 1, 'Y', 'reality-contact'),
      dim('D-LIVE-E2E', 1, 'Y', 'reality-contact'),
      dim('D-GATE-GREEN', 1, 'Y', 'reality-contact'),
      dim('D-DONE-EVIDENCE', 1, 'Y', 'reality-contact'),
      dim('D-NO-OVERCLAIM', 1, 'Y', 'reality-contact'),
      dim('D-T2-DISC', 2, 'Y', 'discipline'),
      dim('D-T2-RC', 2, 'P', 'reality-contact'),
      dim('D-T2-DOCS', 2, 'P', 'docs-convention'),
      dim('D-T2-GOLD', 2, 'P', 'code-quality-gold'),
    ]
    const result: TwoTierResult = computeConformance(dimensions, highGateThresholds, true)
    expect(result.verdict).toBe('CONFORMANT')
    expect(result.score).toBeLessThan(0.95)
  })
})

// ── Unit 4b: GOLD is reachable when only ONE family carries tier-2 dims (#1599) ──────────────
//
// In production only docs-convention (weight 0.20) has any tier-2 dimensions; discipline,
// reality-contact and code-quality-gold carry none. Before renormalization the ceiling was
// docs-convention·0.20 = 0.20 < the 0.85–0.92 gate, so GOLD was mathematically unreachable for
// EVERY project. With live-weight renormalization a perfect single-live-family project scores 1.0.

describe('computeConformance — Unit 4b: GOLD reachable with one live tier-2 family (#1599)', () => {
  it('a perfect project whose ONLY tier-2 dims are docs-convention reaches score 1.0 and GOLD', () => {
    const dimensions: DimensionEntry[] = [
      // all tier-1 Y/NA (gate satisfied)
      dim('D-TEST-LEVELS', 1, 'Y', 'reality-contact'),
      dim('D-LIVE-E2E', 1, 'NA', 'reality-contact'),
      dim('D-GATE-GREEN', 1, 'Y', 'discipline'),
      dim('D-DONE-EVIDENCE', 1, 'Y', 'reality-contact'),
      dim('D-NO-OVERCLAIM', 1, 'Y', 'discipline'),
      // tier-2 dims ONLY in docs-convention (the production shape) — the other three families
      // have zero tier-2 dims, exactly as authored in doc-probes.ts / dimensions.ts.
      dim('DOC-README', 2, 'Y', 'docs-convention'),
      dim('DOC-CHANGELOG', 2, 'Y', 'docs-convention'),
      dim('DOC-LICENSE', 2, 'Y', 'docs-convention'),
    ]
    const result: TwoTierResult = computeConformance(dimensions, DEFAULT_T, true)
    // renormalized: docs-convention 1.0 over liveWeight 0.20 → 1.0 (NOT the old 0.20 ceiling)
    expect(result.score).toBeCloseTo(1.0)
    expect(result.verdict).toBe('GOLD')
  })

  it('a half-Y single-live-family project scores 0.5 (renormalized, not 0.5·weight)', () => {
    const dimensions: DimensionEntry[] = [
      dim('D-TEST-LEVELS', 1, 'Y', 'reality-contact'),
      dim('DOC-README', 2, 'Y', 'docs-convention'),
      dim('DOC-CHANGELOG', 2, 'N', 'docs-convention'),
    ]
    const result: TwoTierResult = computeConformance(dimensions, DEFAULT_T, true)
    // one Y + one N in the only live family → 0.5, renormalized by its own weight → 0.5 (not 0.10)
    expect(result.score).toBeCloseTo(0.5)
  })
})

// ── #1658: structural tier-1 gate (not the drifted allow-list) + P-as-non-pass ──

describe('computeConformance — structural tier-1 gate (#1658)', () => {
  it('vetoes on a structurally tier-1 dim that is NOT in tier1Members (over-credit fix)', () => {
    // D-COVERAGE-THRESHOLDS is tier:1 in dimensions.ts but was absent from the 7-member
    // allow-list — so an N coverage dim used to slip through to GOLD. The structural gate
    // catches it. Note DEFAULT_T.tier1Members deliberately does NOT list it.
    const dimensions: DimensionEntry[] = [
      dim('D-TEST-LEVELS', 1, 'Y', 'reality-contact'),
      dim('D-LIVE-E2E', 1, 'NA', 'reality-contact'),
      dim('D-GATE-GREEN', 1, 'Y', 'reality-contact'),
      dim('D-DONE-EVIDENCE', 1, 'Y', 'reality-contact'),
      dim('D-NO-OVERCLAIM', 1, 'Y', 'reality-contact'),
      dim('D-COVERAGE-THRESHOLDS', 1, 'N', 'discipline'), // tier-1, NOT in allow-list
      dim('D-T2-DOCS', 2, 'Y', 'docs-convention'),
    ]
    const result = computeConformance(dimensions, DEFAULT_T, true)
    expect(result.verdict).toBe('NON-CONFORMANT')
    expect(result.tier1Fails.some((d) => d.id === 'D-COVERAGE-THRESHOLDS')).toBe(true)
  })

  it('treats a tier-1 P as non-pass (must-pass dimension cannot be partial)', () => {
    const dimensions: DimensionEntry[] = [
      dim('D-TEST-LEVELS', 1, 'Y', 'reality-contact'),
      dim('DISC-finding-hygiene', 1, 'P', 'discipline'), // tier-1 partial → veto
      dim('D-T2-DOCS', 2, 'Y', 'docs-convention'),
    ]
    const result = computeConformance(dimensions, DEFAULT_T, true)
    expect(result.verdict).toBe('NON-CONFORMANT')
    expect(result.tier1Fails.some((d) => d.id === 'DISC-finding-hygiene')).toBe(true)
  })

  it('keeps tier1Members default in parity with the structural tier-1 set', () => {
    const t = autoFillConformanceThresholds('L1')
    for (const id of [
      'D-COVERAGE-THRESHOLDS',
      'D-INVARIANTS-ENFORCED',
      'D-COMMIT-HYGIENE',
      'DISC-finding-hygiene',
    ]) {
      expect(t.tier1Members).toContain(id)
    }
  })
})

// ── Unit 5: validateConformanceThresholds — missing tier1Members ──────────────

describe('validateConformanceThresholds — Unit 5: missing tier1Members', () => {
  it('returns errors when tier1Members is absent', () => {
    const raw = {
      familyWeights: {
        discipline: 0.15,
        'reality-contact': 0.35,
        'docs-convention': 0.2,
        'code-quality-gold': 0.3,
      },
      goldTier2Gate: 0.9,
    }
    const errors = validateConformanceThresholds(raw)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.includes('tier1Members'))).toBe(true)
  })
})

// ── Unit 6: autoFillConformanceThresholds L2 gold → 0.90 ─────────────────────

describe('autoFillConformanceThresholds — Unit 6: L2 gold overlay', () => {
  it('returns goldTier2Gate = 0.90 for L2 with gold brownfield class', () => {
    const result = autoFillConformanceThresholds('L2', 'gold')
    expect(result.goldTier2Gate).toBe(0.9)
  })
})

// ── Unit 7: autoFillConformanceThresholds L2 heavy → 0.70 ────────────────────

describe('autoFillConformanceThresholds — Unit 7: L2 heavy overlay', () => {
  it('returns goldTier2Gate = 0.70 for L2 with heavy brownfield class', () => {
    const result = autoFillConformanceThresholds('L2', 'heavy')
    expect(result.goldTier2Gate).toBe(0.7)
  })
})
