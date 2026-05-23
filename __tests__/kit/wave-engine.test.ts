// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { buildWavePlan, type DimAssessment } from '../../src/kit/wave-engine.js'

function makeAssessments(overrides: Partial<Record<string, DimAssessment>> = {}): DimAssessment[] {
  return [
    { dimId: 'N01', status: 'Y', category: 'testing' },
    { dimId: 'N02', status: 'N', category: 'testing' },
    { dimId: 'N03', status: 'P', category: 'static-analysis' },
    { dimId: 'N04', status: 'NA', category: 'security' },
    ...Object.entries(overrides).map(([dimId, a]) => ({ ...a, dimId })),
  ].filter((a, i, arr) => arr.findIndex((b) => b.dimId === a.dimId) === i)
}

describe('buildWavePlan', () => {
  it('returns a 4-wave plan', () => {
    const plan = buildWavePlan(makeAssessments(), 'gold')
    expect(plan.waves).toHaveLength(4)
    const labels = plan.waves.map((w) => w.label)
    expect(labels).toEqual(['W0', 'W1', 'W2', 'W3'])
  })

  it('W0 contains dims with Y status (already covered — bootstrap confirms)', () => {
    const plan = buildWavePlan(makeAssessments(), 'gold')
    const w0 = plan.waves[0]!
    expect(w0.dimensions.some((d) => d.dimId === 'N01')).toBe(true)
  })

  it('W1 contains dims with P status (partial coverage)', () => {
    const plan = buildWavePlan(makeAssessments(), 'gold')
    const w1 = plan.waves[1]!
    expect(w1.dimensions.some((d) => d.dimId === 'N03')).toBe(true)
  })

  it('W2 contains dims with N status (not covered)', () => {
    const plan = buildWavePlan(makeAssessments(), 'gold')
    const w2 = plan.waves[2]!
    expect(w2.dimensions.some((d) => d.dimId === 'N02')).toBe(true)
  })

  it('W3 is reserved (empty) — gold-phase aspirational bucket', () => {
    const plan = buildWavePlan(makeAssessments(), 'gold')
    const w3 = plan.waves[3]!
    expect(w3.dimensions).toHaveLength(0)
  })

  it('NA dims not assigned to any wave', () => {
    const plan = buildWavePlan(makeAssessments(), 'gold')
    const allDimIds = plan.waves.flatMap((w) => w.dimensions.map((d) => d.dimId))
    expect(allDimIds).not.toContain('N04')
  })

  it('browfieldClass heavy adjusts W0 goal label', () => {
    const plan = buildWavePlan(makeAssessments(), 'heavy')
    expect(plan.waves[0]!.goal).toContain('heavy')
  })

  it('empty assessments produces valid empty-wave plan', () => {
    const plan = buildWavePlan([], 'gold')
    expect(plan.waves).toHaveLength(4)
    plan.waves.forEach((w) => expect(w.dimensions).toHaveLength(0))
  })

  it('plan.summary counts match actual dims per wave', () => {
    const plan = buildWavePlan(makeAssessments(), 'medium')
    const counted = plan.waves.reduce((s, w) => s + w.dimensions.length, 0)
    expect(plan.summary.totalDims).toBe(counted)
  })

  it('all non-NA dims appear in exactly one wave', () => {
    const assessments = makeAssessments()
    const plan = buildWavePlan(assessments, 'light')
    const nonNa = assessments.filter((a) => a.status !== 'NA').map((a) => a.dimId)
    const allAssigned = plan.waves.flatMap((w) => w.dimensions.map((d) => d.dimId))
    expect(new Set(allAssigned).size).toBe(allAssigned.length)
    for (const id of nonNa) {
      expect(allAssigned).toContain(id)
    }
  })
})
