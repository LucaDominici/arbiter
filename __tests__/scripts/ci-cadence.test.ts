// SPDX-License-Identifier: Apache-2.0
// TDD guard for #1502 PORT D1 — the CI cadence-bucket SSOT (scripts/lib/ci-cadence.mjs)
// is the executable anchor for docs/SYSTEM/CI-TIER-MODEL.md. Every canonical CI-tier
// workflow must be classified into exactly one cadence bucket (ALWAYS / NIGHTLY /
// WEEKLY-MONTHLY / PROD), so a newly-added canonical workflow cannot drift the docs
// without also failing this test + the check-ci-tiers gate.
import { describe, it, expect } from 'vitest'
import {
  CADENCE_BUCKETS,
  CADENCE_ORDER,
  cadenceOf,
  assertCanonicalPartition,
} from '../../scripts/lib/ci-cadence.mjs'

// The INV-73 canonical 8 (mirrors check-ci-tiers.mjs ALL_CANONICAL).
const ALL_CANONICAL = [
  '01-pr-fast.yml',
  '02-pr-extended.yml',
  '03-human-approval.yml',
  '05-release.yml',
  '06-nightly.yml',
  '07-weekly.yml',
  '08-monthly.yml',
  '09-heartbeat.yml',
]

describe('ci-cadence SSOT (#1502 D1)', () => {
  it('declares exactly the four cadence buckets in canonical order', () => {
    expect(CADENCE_ORDER).toEqual(['ALWAYS', 'NIGHTLY', 'WEEKLY-MONTHLY', 'PROD'])
    expect(Object.keys(CADENCE_BUCKETS).sort()).toEqual([...CADENCE_ORDER].sort())
  })

  it('classifies every canonical workflow into exactly one bucket', () => {
    for (const wf of ALL_CANONICAL) {
      const buckets = CADENCE_ORDER.filter((b) => CADENCE_BUCKETS[b].includes(wf))
      expect(
        buckets,
        `${wf} must be in exactly one bucket, found: ${buckets.join(',')}`,
      ).toHaveLength(1)
    }
  })

  it('never assigns any workflow to two buckets (global partition)', () => {
    const seen = new Set<string>()
    for (const b of CADENCE_ORDER) {
      for (const wf of CADENCE_BUCKETS[b]) {
        expect(seen.has(wf), `${wf} appears in more than one bucket`).toBe(false)
        seen.add(wf)
      }
    }
  })

  it('cadenceOf resolves the bucket for a known workflow and null otherwise', () => {
    expect(cadenceOf('01-pr-fast.yml')).toBe('ALWAYS')
    expect(cadenceOf('06-nightly.yml')).toBe('NIGHTLY')
    expect(cadenceOf('07-weekly.yml')).toBe('WEEKLY-MONTHLY')
    expect(cadenceOf('05-release.yml')).toBe('PROD')
    expect(cadenceOf('does-not-exist.yml')).toBeNull()
  })

  it('assertCanonicalPartition returns no errors for the canonical 8', () => {
    expect(assertCanonicalPartition(ALL_CANONICAL)).toEqual([])
  })

  it('assertCanonicalPartition reports an unclassified canonical workflow', () => {
    const errors = assertCanonicalPartition([...ALL_CANONICAL, '99-unmapped.yml'])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('99-unmapped.yml')
  })
})
