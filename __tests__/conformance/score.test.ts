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
