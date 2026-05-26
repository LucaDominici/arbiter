// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { hostname } from 'node:os'
import { renderAuditMarkdown } from '../../src/kit/audit-report.js'
import type { WavePlan } from '../../src/kit/wave-engine.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWavePlan(): WavePlan {
  return {
    brownfieldClass: 'gold',
    waves: [
      {
        label: 'W0',
        goal: 'Bootstrap',
        dimensions: [{ dimId: 'N01', status: 'Y', category: 'testing' }],
      },
      {
        label: 'W1',
        goal: 'Enforcement',
        dimensions: [{ dimId: 'N03', status: 'P', category: 'static-analysis' }],
      },
      {
        label: 'W2',
        goal: 'Advanced',
        dimensions: [{ dimId: 'N02', status: 'N', category: 'testing' }],
      },
      { label: 'W3', goal: 'Gold', dimensions: [] },
    ],
    summary: { totalDims: 3, byWave: { W0: 1, W1: 1, W2: 1, W3: 0 } },
  }
}

function makeMeasurements(): Record<
  string,
  { status: 'present' | 'partial' | 'missing'; evidence: string[] }
> {
  return {
    N01: { status: 'present', evidence: ['__tests__/foo.test.ts'] },
    N02: { status: 'missing', evidence: [] },
    N03: { status: 'partial', evidence: ['src/lint/.eslintrc.js'] },
  }
}

function makeApplicabilityReasons(): Record<string, string> {
  return {}
}

// ─── Basic structure ──────────────────────────────────────────────────────────

describe('renderAuditMarkdown', () => {
  it('returns a non-empty string', () => {
    const md = renderAuditMarkdown(makeMeasurements(), makeWavePlan(), makeApplicabilityReasons())
    expect(typeof md).toBe('string')
    expect(md.length).toBeGreaterThan(100)
  })

  it('contains a title', () => {
    const md = renderAuditMarkdown(makeMeasurements(), makeWavePlan(), makeApplicabilityReasons())
    expect(md).toMatch(/# .+KIT.*Audit|# SELF-KIT/i)
  })

  it('contains dim IDs', () => {
    const md = renderAuditMarkdown(makeMeasurements(), makeWavePlan(), makeApplicabilityReasons())
    expect(md).toContain('N01')
    expect(md).toContain('N02')
    expect(md).toContain('N03')
  })

  it('contains wave labels', () => {
    const md = renderAuditMarkdown(makeMeasurements(), makeWavePlan(), makeApplicabilityReasons())
    expect(md).toMatch(/W0|W1|W2/)
  })

  it('reflects present/partial/missing status', () => {
    const md = renderAuditMarkdown(makeMeasurements(), makeWavePlan(), makeApplicabilityReasons())
    expect(md).toMatch(/PRESENT|present|✅/i)
    expect(md).toMatch(/MISSING|missing|❌/i)
    expect(md).toMatch(/PARTIAL|partial|⚠/i)
  })
})

// ─── Determinism ──────────────────────────────────────────────────────────────

describe('renderAuditMarkdown — determinism', () => {
  it('produces byte-identical output on repeated calls', () => {
    const a = renderAuditMarkdown(makeMeasurements(), makeWavePlan(), makeApplicabilityReasons())
    const b = renderAuditMarkdown(makeMeasurements(), makeWavePlan(), makeApplicabilityReasons())
    expect(a).toBe(b)
  })

  it('does not include current timestamp', () => {
    const md = renderAuditMarkdown(makeMeasurements(), makeWavePlan(), makeApplicabilityReasons())
    expect(md).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('does not include hostname or env-derived values', () => {
    const md = renderAuditMarkdown(makeMeasurements(), makeWavePlan(), makeApplicabilityReasons())
    expect(md).not.toContain(hostname())
  })
})

// ─── NA dims shown with reason ────────────────────────────────────────────────

describe('renderAuditMarkdown — NA dims', () => {
  it('includes NA reason for dims with applicability reason', () => {
    const reasons = { N12: 'language is not java/kotlin' }
    const measurements = {
      ...makeMeasurements(),
      N12: { status: 'missing' as const, evidence: [] },
    }
    const plan = makeWavePlan()
    const md = renderAuditMarkdown(measurements, plan, reasons)
    expect(md).toContain('N12')
    expect(md).toContain('language is not java/kotlin')
  })
})

// ─── Empty wave plan ──────────────────────────────────────────────────────────

describe('renderAuditMarkdown — edge cases', () => {
  it('handles empty measurements without throwing', () => {
    const plan: WavePlan = {
      brownfieldClass: 'silver',
      waves: [
        { label: 'W0', goal: 'Bootstrap', dimensions: [] },
        { label: 'W1', goal: 'Enforcement', dimensions: [] },
        { label: 'W2', goal: 'Advanced', dimensions: [] },
        { label: 'W3', goal: 'Gold', dimensions: [] },
      ],
      summary: { totalDims: 0, byWave: { W0: 0, W1: 0, W2: 0, W3: 0 } },
    }
    expect(() => renderAuditMarkdown({}, plan, {})).not.toThrow()
  })
})
