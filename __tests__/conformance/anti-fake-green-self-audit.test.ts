// SPDX-License-Identifier: Apache-2.0
// N2 self-audit ("audit the auditors", #1412): proves each anti-fake-green guard still DETECTS
// its violation. A guard that can't detect its own violation is itself a falso-green. Runs as a
// unit test (npm test) — i.e. before the gate body in check-all. The gh-audit guards are tested
// via their pure cores offline; the file-scan guards (#1/#6/E10) are exercised end-to-end on
// synthetic fixtures (a violation must BLOCK with exit 1; clean / NA must PASS with exit 0).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  classifyReview,
  classifyOwnership,
  isDocOnly,
  dependabotBumpLevel,
  V,
} from '../../scripts/lib/anti-fake-green-core.mjs'

/** Run a file-scan guard against a synthetic fixture dir; return its exit code. */
function guardExit(script: string, dir: string): number {
  const r = spawnSync('node', [resolve('scripts', script), '--dir', dir], { encoding: 'utf-8' })
  return r.status ?? 1
}
function withTmp<T>(prefix: string, fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

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

describe('anti-fake-green self-audit — #1 muted-test (file-scan)', () => {
  it('liveness: an it.skip on a gate test BLOCKS (exit 1)', () => {
    withTmp('n2-muted-bad-', (dir) => {
      mkdirSync(join(dir, '__tests__'), { recursive: true })
      writeFileSync(join(dir, '__tests__', 'a.test.ts'), "it.skip('muted', () => {})\n")
      expect(guardExit('check-muted-test.mjs', dir)).toBe(1)
    })
  })
  it('clean populated test dir PASSES (exit 0)', () => {
    withTmp('n2-muted-ok-', (dir) => {
      mkdirSync(join(dir, '__tests__'), { recursive: true })
      writeFileSync(join(dir, '__tests__', 'a.test.ts'), "it('ok', () => { expect(1).toBe(1) })\n")
      expect(guardExit('check-muted-test.mjs', dir)).toBe(0)
    })
  })
  it('NO-DATA (no test files) is a SKIP at exit 0, never a manufactured pass', () => {
    withTmp('n2-muted-nodata-', (dir) => {
      expect(guardExit('check-muted-test.mjs', dir)).toBe(0)
    })
  })
})

describe('anti-fake-green self-audit — #6 skip-critical-e2e (file-scan)', () => {
  it('liveness: a skipped e2e spec BLOCKS (exit 1)', () => {
    withTmp('n2-e2e-bad-', (dir) => {
      writeFileSync(join(dir, 'playwright.config.ts'), 'export default {}\n')
      mkdirSync(join(dir, 'e2e'), { recursive: true })
      writeFileSync(join(dir, 'e2e', 'a.spec.ts'), "test.skip('x', async () => {})\n")
      expect(guardExit('check-skip-critical-e2e.mjs', dir)).toBe(1)
    })
  })
  it('clean e2e spec PASSES (exit 0)', () => {
    withTmp('n2-e2e-ok-', (dir) => {
      writeFileSync(join(dir, 'playwright.config.ts'), 'export default {}\n')
      mkdirSync(join(dir, 'e2e'), { recursive: true })
      writeFileSync(join(dir, 'e2e', 'a.spec.ts'), "test('x', async () => {})\n")
      expect(guardExit('check-skip-critical-e2e.mjs', dir)).toBe(0)
    })
  })
  it('no e2e config → NA at exit 0 (nothing to skip), never a manufactured fail', () => {
    withTmp('n2-e2e-na-', (dir) => {
      expect(guardExit('check-skip-critical-e2e.mjs', dir)).toBe(0)
    })
  })
})

describe('anti-fake-green self-audit — E10 no-stub-redirects (file-scan)', () => {
  const STUB = '# Moved\n\nThis page has moved to [the new home](./new.md).\n'
  it('liveness: a stale "Moved →" stub BLOCKS (exit 1)', () => {
    withTmp('n2-stub-bad-', (dir) => {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'old.md'), STUB)
      expect(guardExit('check-no-stub-redirects.mjs', dir)).toBe(1)
    })
  })
  it('a real doc PASSES (exit 0)', () => {
    withTmp('n2-stub-ok-', (dir) => {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(
        join(dir, 'docs', 'real.md'),
        '# Real\n\n' + 'genuine content here. '.repeat(30) + '\n',
      )
      expect(guardExit('check-no-stub-redirects.mjs', dir)).toBe(0)
    })
  })
  it('an open-ended allowlist (no EXPIRES) does NOT disarm the guard (exit 1)', () => {
    withTmp('n2-stub-allow-', (dir) => {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'old.md'), STUB)
      writeFileSync(join(dir, '.stub-redirects-allowlist'), 'docs/old.md  # no expiry\n')
      expect(guardExit('check-no-stub-redirects.mjs', dir)).toBe(1)
    })
  })
})
