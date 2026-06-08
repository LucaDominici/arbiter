// SPDX-License-Identifier: Apache-2.0
//
// #1259 — pairwise issue-correlation affinity scorer (ported from viafera /task §7.3).
import { describe, it, expect } from 'vitest'
import {
  AFFINITY_THRESHOLD,
  scoreAffinity,
  computeAffinityReport,
  formatAffinityLines,
  type AffinityIssue,
} from '../../src/affinity/affinity.js'

function issue(partial: Partial<AffinityIssue> & { id: string }): AffinityIssue {
  return { labels: [], ...partial }
}

describe('scoreAffinity — viafera rubric weights', () => {
  it('threshold default is 3', () => {
    expect(AFFINITY_THRESHOLD).toBe(3)
  })

  it('+2 for a shared domain:* label', () => {
    const a = issue({ id: '#1', labels: ['domain:billing'] })
    const b = issue({ id: '#2', labels: ['domain:billing'] })
    expect(scoreAffinity(a, b)).toBe(2)
  })

  it('+2 for overlapping files', () => {
    const a = issue({ id: '#1', files: ['src/x.ts', 'src/y.ts'] })
    const b = issue({ id: '#2', files: ['src/y.ts'] })
    expect(scoreAffinity(a, b)).toBe(2)
  })

  it('+1 for same milestone', () => {
    const a = issue({ id: '#1', milestone: 'M5' })
    const b = issue({ id: '#2', milestone: 'M5' })
    expect(scoreAffinity(a, b)).toBe(1)
  })

  it('+1 for a shared type:* label', () => {
    const a = issue({ id: '#1', labels: ['type:feat'] })
    const b = issue({ id: '#2', labels: ['type:feat'] })
    expect(scoreAffinity(a, b)).toBe(1)
  })

  it('sums to a correlated score (domain + milestone + type = 4)', () => {
    const a = issue({ id: '#1', labels: ['domain:billing', 'type:feat'], milestone: 'M5' })
    const b = issue({ id: '#2', labels: ['domain:billing', 'type:feat'], milestone: 'M5' })
    expect(scoreAffinity(a, b)).toBe(4)
  })

  it('unrelated issues score 0', () => {
    const a = issue({ id: '#1', labels: ['domain:a'], milestone: 'M1' })
    const b = issue({ id: '#2', labels: ['domain:b'], milestone: 'M2' })
    expect(scoreAffinity(a, b)).toBe(0)
  })

  it('does not double-count multiple shared domain labels', () => {
    const a = issue({ id: '#1', labels: ['domain:a', 'domain:b'] })
    const b = issue({ id: '#2', labels: ['domain:a', 'domain:b'] })
    expect(scoreAffinity(a, b)).toBe(2)
  })
})

describe('computeAffinityReport — single-issue reduction', () => {
  const subject = issue({ id: '#1259', labels: ['domain:dx', 'type:feat'], milestone: 'M5' })

  it('reports best score across candidates and marks correlated when >= threshold', () => {
    const candidates = [
      issue({ id: '#1260', labels: ['domain:dx', 'type:feat'], milestone: 'M5' }), // 4
      issue({ id: '#9', labels: ['domain:x'], milestone: 'M1' }), // 0
    ]
    const report = computeAffinityReport(subject, candidates)
    expect(report.best?.id).toBe('#1260')
    expect(report.best?.score).toBe(4)
    expect(report.correlated).toBe(true)
    expect(report.pairs).toHaveLength(2)
  })

  it('marks low-affinity when all candidates are below threshold', () => {
    const candidates = [issue({ id: '#9', labels: ['type:feat'], milestone: 'M1' })] // 1
    const report = computeAffinityReport(subject, candidates)
    expect(report.correlated).toBe(false)
    expect(report.best?.score).toBe(1)
  })

  it('treats a solo issue (no candidates) as not correlated', () => {
    const report = computeAffinityReport(subject, [])
    expect(report.correlated).toBe(false)
    expect(report.best).toBeNull()
    expect(report.reason).toBe('solo')
  })

  it('honors a custom threshold override', () => {
    const candidates = [issue({ id: '#2', labels: ['type:feat'] })] // 1
    expect(computeAffinityReport(subject, candidates, 1).correlated).toBe(true)
    expect(computeAffinityReport(subject, candidates, 2).correlated).toBe(false)
  })
})

describe('formatAffinityLines — step output', () => {
  const subject = issue({ id: '#1259', labels: ['domain:dx'], milestone: 'M5' })

  it('always emits an Affinity header line', () => {
    const lines = formatAffinityLines(computeAffinityReport(subject, []))
    expect(lines.some((l) => /Affinity/i.test(l))).toBe(true)
  })

  it('emits a WARNING line when below threshold', () => {
    const candidates = [issue({ id: '#9', labels: ['type:other'] })] // 0
    const lines = formatAffinityLines(computeAffinityReport(subject, candidates))
    expect(lines.some((l) => /WARN/i.test(l) && /affinity/i.test(l))).toBe(true)
  })

  it('does NOT warn when correlated (>= threshold)', () => {
    const candidates = [issue({ id: '#9', labels: ['domain:dx', 'type:feat'], milestone: 'M5' })] // 4
    const lines = formatAffinityLines(computeAffinityReport(subject, candidates))
    expect(lines.some((l) => /WARN/i.test(l))).toBe(false)
  })

  it('renders the per-candidate score pairs', () => {
    const candidates = [issue({ id: '#1260', labels: ['domain:dx'], milestone: 'M5' })] // 3
    const lines = formatAffinityLines(computeAffinityReport(subject, candidates))
    expect(lines.some((l) => l.includes('#1260'))).toBe(true)
  })
})
