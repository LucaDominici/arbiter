// SPDX-License-Identifier: Apache-2.0
// #1405 — DISC-finding-hygiene conformance probe.
//
// Verdict semantics (anti-gaming, INV-114): rewards DRAINING the findings spool,
// never the mere act of filing findings.
//   - spool absent              → NA (not governed for findings yet)
//   - drained (count 0)         → Y
//   - fresh + non-regressing    → Y
//   - stale (oldest age > thr)  → P
//   - regression vs prior count → N
// Evidence = the findings spool path. Filing N findings without draining must
// NEVER yield Y.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { probeFindingHygiene } from '../../src/conformance/dimensions.js'

const created: string[] = []
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'finding-hygiene-probe-'))
  created.push(dir)
  return dir
}

function findingAt(daysAgo: number, fp: string): Record<string, unknown> {
  const ts = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
  return {
    ts,
    note: `finding ${fp}`,
    kind: 'smell',
    severity: 'low',
    foundDuring: 'task/#x',
    file: 'src/a.ts',
    line: 1,
    sha: 'deadbeef',
    fingerprint: fp,
  }
}

function writeSpool(dir: string, shard: string, entries: Array<Record<string, unknown>>): void {
  const findingsDir = join(dir, '.arbiter', 'findings')
  mkdirSync(findingsDir, { recursive: true })
  const body = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '')
  writeFileSync(join(findingsDir, `${shard}.jsonl`), body, 'utf-8')
}

/** Write the conformance finding-hygiene prior (openFindingsCount snapshot). */
function writePrior(dir: string, count: number): void {
  const d = join(dir, '.arbiter')
  mkdirSync(d, { recursive: true })
  writeFileSync(
    join(d, 'finding-hygiene-baseline.json'),
    JSON.stringify({ openFindingsCount: count }),
  )
}

describe('probeFindingHygiene (#1405)', () => {
  it('is exported and returns a DISC-finding-hygiene entry', () => {
    const root = tmpRoot()
    const entry = probeFindingHygiene(root)
    expect(entry.id).toBe('DISC-finding-hygiene')
    expect(entry.family).toBe('discipline')
  })

  it('NA when the findings spool is absent (not regression, not N)', () => {
    const root = tmpRoot()
    const entry = probeFindingHygiene(root)
    expect(entry.verdict).toBe('NA')
    expect(entry.evidence).toHaveProperty('file')
  })

  it('Y when the spool is drained (0 open findings)', () => {
    const root = tmpRoot()
    mkdirSync(join(root, '.arbiter', 'findings'), { recursive: true })
    const entry = probeFindingHygiene(root)
    expect(entry.verdict).toBe('Y')
  })

  it('Y when findings are fresh and not regressing vs prior', () => {
    const root = tmpRoot()
    writePrior(root, 2)
    // 2 findings, both fresh (well under the 14d threshold), no regression
    writeSpool(root, 'shard', [findingAt(1, 'fp1'), findingAt(2, 'fp2')])
    const entry = probeFindingHygiene(root)
    expect(entry.verdict).toBe('Y')
    // Evidence points at the spool, not at a synthetic count
    expect((entry.evidence as { file: string }).file).toContain('findings')
  })

  it('P when the oldest unpromoted finding is stale (> threshold) but no count regression', () => {
    const root = tmpRoot()
    writePrior(root, 1)
    writeSpool(root, 'shard', [findingAt(40, 'fp1')]) // 40 days old, > 14d threshold
    const entry = probeFindingHygiene(root)
    expect(entry.verdict).toBe('P')
  })

  it('N when openFindingsCount regresses vs prior (count rose)', () => {
    const root = tmpRoot()
    writePrior(root, 1)
    writeSpool(root, 'shard', [findingAt(1, 'fp1'), findingAt(1, 'fp2'), findingAt(1, 'fp3')])
    const entry = probeFindingHygiene(root)
    expect(entry.verdict).toBe('N')
  })

  it('ANTI-GAMING: filing fresh findings without draining never yields Y when count regresses', () => {
    const root = tmpRoot()
    writePrior(root, 0) // previously drained
    // Now 3 brand-new (fresh) findings filed — count rose 0 → 3.
    writeSpool(root, 'shard', [findingAt(0, 'a'), findingAt(0, 'b'), findingAt(0, 'c')])
    const entry = probeFindingHygiene(root)
    expect(entry.verdict).not.toBe('Y')
    expect(entry.verdict).toBe('N')
  })

  it('no prior baseline → fresh non-empty spool is Y (bootstrap, no false regression)', () => {
    const root = tmpRoot()
    // No finding-hygiene-baseline.json: first observation, fresh findings → Y
    writeSpool(root, 'shard', [findingAt(1, 'fp1')])
    const entry = probeFindingHygiene(root)
    expect(entry.verdict).toBe('Y')
  })

  it('is fail-safe: never throws on a malformed spool', () => {
    const root = tmpRoot()
    const findingsDir = join(root, '.arbiter', 'findings')
    mkdirSync(findingsDir, { recursive: true })
    writeFileSync(join(findingsDir, 'shard.jsonl'), 'not json\n{broken\n', 'utf-8')
    expect(() => probeFindingHygiene(root)).not.toThrow()
  })
})
