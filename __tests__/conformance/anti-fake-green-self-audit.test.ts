// SPDX-License-Identifier: Apache-2.0
// N2 self-audit ("audit the auditors", #1412): proves each anti-fake-green guard still DETECTS
// its violation. A guard that can't detect its own violation is itself a falso-green. Runs as a
// unit test (npm test) — i.e. before the gate body in check-all. Tests the pure cores offline.
import { describe, it, expect } from 'vitest'
import {
  classifyReview,
  classifyOwnership,
  isDocOnly,
  dependabotBumpLevel,
  V,
} from '../../scripts/lib/anti-fake-green-core.mjs'

const mk = (over: Record<string, unknown> = {}) => ({
  author: { login: 'alice' },
  createdAt: '2026-01-01T00:00:00Z',
  mergedAt: '2026-01-01T00:03:00Z',
  files: [{ path: 'src/x.ts' }],
  latestReviews: [],
  labels: [],
  ...over,
})

describe('anti-fake-green self-audit — #9 review effort', () => {
  it('T01 TC-2: reads latestReviews, not stale reviews[] — withdrawn approval ⇒ VIOLATION', () => {
    expect(
      classifyReview(
        mk({ latestReviews: [{ author: { login: 'bob' }, state: 'CHANGES_REQUESTED' }] }),
      ).verdict,
    ).toBe(V.VIOLATION)
  })
  it('T02 real non-author approval + fast ⇒ PASS (approval is the property)', () => {
    expect(
      classifyReview(mk({ latestReviews: [{ author: { login: 'bob' }, state: 'APPROVED' }] }))
        .verdict,
    ).toBe(V.PASS)
  })
  it('T03 zero approval + fast code merge ⇒ VIOLATION (detector liveness)', () => {
    expect(classifyReview(mk()).verdict).toBe(V.VIOLATION)
  })
  it('T04 doc-only within 1h window ⇒ PASS', () => {
    expect(
      classifyReview(mk({ files: [{ path: 'docs/x.md' }], mergedAt: '2026-01-01T01:30:00Z' }))
        .verdict,
    ).toBe(V.PASS)
  })
  it('T05/T06 dependabot patch EXEMPT, major VIOLATION', () => {
    const base = { author: { login: 'dependabot[bot]' }, files: [{ path: 'package.json' }] }
    expect(classifyReview(mk({ ...base, title: 'bump x from 1.2.3 to 1.2.4' })).verdict).toBe(
      V.EXEMPT,
    )
    expect(classifyReview(mk({ ...base, title: 'bump x from 1.2.3 to 2.0.0' })).verdict).toBe(
      V.VIOLATION,
    )
  })
  it('T07 min-review-exempt label ⇒ EXEMPT', () => {
    expect(classifyReview(mk({ labels: [{ name: 'min-review-exempt' }] })).verdict).toBe(V.EXEMPT)
  })
  it('T08 trunk-solo attested ⇒ EXEMPT', () => {
    expect(classifyReview(mk(), { soloExempt: true }).verdict).toBe(V.EXEMPT)
  })
  it('NO-DATA: not-merged PR ⇒ NV, never PASS', () => {
    expect(classifyReview(mk({ mergedAt: null })).verdict).toBe(V.NV)
  })
  it('dependabotBumpLevel + isDocOnly helpers', () => {
    expect(dependabotBumpLevel('bump a from 1.0.0 to 1.0.1')).toBe('patch')
    expect(dependabotBumpLevel('bump a from 1.0.0 to 2.0.0')).toBe('major')
    expect(isDocOnly([{ path: 'docs/a.md' }, { path: 'b.md' }])).toBe(true)
    expect(isDocOnly([{ path: 'src/a.ts' }])).toBe(false)
    expect(isDocOnly([])).toBe(false)
  })
})

describe('anti-fake-green self-audit — #10 ownership concentration', () => {
  const issues = (spec: Array<[string, string | null]>) =>
    spec.map(([lbl, owner]) => ({ labels: [lbl], assignees: owner ? [{ login: owner }] : [] }))
  it('T13 NF-2: configured owner matches nothing ⇒ NV, never PASS', () => {
    expect(classifyOwnership(issues([['P0', 'alice']]), { ownerHint: 'ghost' }).verdict).toBe(V.NV)
  })
  it('T14 zero P0/P1 ⇒ NV (nothing to measure ≠ well-distributed)', () => {
    expect(classifyOwnership(issues([['chore', null]]), {}).verdict).toBe(V.NV)
  })
  it('T15 empirical dominant 80% ⇒ VIOLATION (no --owner needed)', () => {
    const data = Array.from({ length: 10 }, (_, i) => ({
      labels: ['P0'],
      assignees: [{ login: i < 8 ? 'a' : 'b' }],
    }))
    expect(classifyOwnership(data, {}).verdict).toBe(V.VIOLATION)
  })
  it('T16 unassigned counts toward concentration', () => {
    const data = Array.from({ length: 10 }, (_, i) => ({
      labels: ['P0'],
      assignees: i < 4 ? [{ login: 'a' }] : i < 8 ? [] : [{ login: 'b' }],
    }))
    expect(classifyOwnership(data, {}).verdict).toBe(V.VIOLATION)
  })
  it('T17 distributed across 4 owners ⇒ PASS', () => {
    const data = Array.from({ length: 12 }, (_, i) => ({
      labels: ['P0'],
      assignees: [{ login: ['a', 'b', 'c', 'd'][i % 4] }],
    }))
    expect(classifyOwnership(data, {}).verdict).toBe(V.PASS)
  })
  it('T18 trunk-solo attested ⇒ EXEMPT', () => {
    expect(classifyOwnership(issues([['P0', 'a']]), { soloExempt: true }).verdict).toBe(V.EXEMPT)
  })
  it('determinism: identical input ⇒ identical verdict+reason', () => {
    const data = issues([
      ['P0', 'a'],
      ['P1', 'b'],
    ])
    expect(JSON.stringify(classifyOwnership(data, {}))).toBe(
      JSON.stringify(classifyOwnership(data, {})),
    )
  })
})
