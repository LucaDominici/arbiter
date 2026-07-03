// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { describe, it, expect, afterEach } from 'vitest'
import {
  runFindingsPromote,
  type PromoteDeps,
  type IssueSearchResult,
} from '../../src/commands/findings-promote.js'

/** Mirror of task-note.ts computeFingerprint material (SSOT dedup material). */
function fp(parts: { kind: string; file: string; symbol: string; note: string }): string {
  const normPath = parts.file.replace(/\\/g, '/').replace(/^\.\//, '')
  const normNote = parts.note.trim().replace(/\s+/g, ' ')
  return createHash('sha1')
    .update([parts.kind, normPath, parts.symbol, normNote].join(' '))
    .digest('hex')
}

interface MiniFinding {
  kind: string
  severity: string
  note: string
  file?: string
  symbol?: string
  graphNode?: string
  fingerprint: string
  sha?: string
  ts?: string
  line?: number | null
  foundDuring?: string
}

describe('runFindingsPromote()', () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  function tmpRepo(): string {
    const d = mkdtempSync(join(tmpdir(), 'findings-promote-'))
    dirs.push(d)
    return d
  }

  function writeShard(dir: string, shard: string, findings: MiniFinding[]): void {
    const fdir = join(dir, '.arbiter', 'findings')
    mkdirSync(fdir, { recursive: true })
    const lines = findings.map((f) =>
      JSON.stringify({
        ts: f.ts ?? '2026-06-16T00:00:00.000Z',
        note: f.note,
        kind: f.kind,
        severity: f.severity,
        foundDuring: f.foundDuring ?? '#1403',
        file: f.file ?? '',
        line: f.line ?? null,
        sha: f.sha ?? 'deadbeef',
        ...(f.graphNode !== undefined ? { graphNode: f.graphNode } : {}),
        fingerprint: f.fingerprint,
      }),
    )
    writeFileSync(join(fdir, `${shard}.jsonl`), lines.join('\n') + '\n', 'utf-8')
  }

  /** A spy-backed deps stub. Records issues "created" and answers searches from a table. */
  function makeDeps(
    overrides: Partial<PromoteDeps> & { searchTable?: Record<string, IssueSearchResult> } = {},
  ): { deps: PromoteDeps; created: Array<{ labels: readonly string[]; body: string }> } {
    const created: Array<{ labels: readonly string[]; body: string }> = []
    let next = 5000
    const searchTable = overrides.searchTable ?? {}
    const deps: PromoteDeps = {
      ensureFindingLabel: overrides.ensureFindingLabel ?? (() => {}),
      searchIssueByFingerprint:
        overrides.searchIssueByFingerprint ?? ((_dir, fpHash) => searchTable[fpHash] ?? null),
      createIssue:
        overrides.createIssue ??
        ((_dir, input) => {
          created.push({ labels: input.labels, body: input.body })
          return { ok: true, issueNumber: next++ }
        }),
      graphFresh: overrides.graphFresh ?? (() => false),
      graphHasNode: overrides.graphHasNode ?? (() => false),
    }
    return { deps, created }
  }

  it('spool absent → no-op (exit ok, nothing filed)', () => {
    const dir = tmpRepo()
    const { deps, created } = makeDeps()
    const r = runFindingsPromote({ dir }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.promoted).toEqual([])
    expect(created).toHaveLength(0)
  })

  it('spool empty (no lines) → no-op', () => {
    const dir = tmpRepo()
    mkdirSync(join(dir, '.arbiter', 'findings'), { recursive: true })
    writeFileSync(join(dir, '.arbiter', 'findings', 'shard.jsonl'), '', 'utf-8')
    const { deps, created } = makeDeps()
    const r = runFindingsPromote({ dir }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(created).toHaveLength(0)
  })

  it('(unit 2) finding whose file is gone → DROPPED, never filed', () => {
    const dir = tmpRepo()
    const f = {
      kind: 'smell',
      file: 'src/does-not-exist.ts',
      symbol: 'foo',
      note: 'dead helper',
    }
    writeShard(dir, 's1', [{ ...f, severity: 'low', fingerprint: fp(f) }])
    const { deps, created } = makeDeps()
    const r = runFindingsPromote({ dir }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(created).toHaveLength(0)
    expect(r.dropped.map((d) => d.fingerprint)).toContain(fp(f))
  })

  it('(unit 1a) dedup WITHIN spool by fingerprint → filed exactly once', () => {
    const dir = tmpRepo()
    // file exists so it survives the ladder
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const f = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'recheck this' }
    const entry = { ...f, severity: 'high', fingerprint: fp(f) }
    writeShard(dir, 'a', [entry])
    writeShard(dir, 'b', [entry]) // same fingerprint in another shard
    const { deps, created } = makeDeps()
    const r = runFindingsPromote({ dir }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(created).toHaveLength(1)
    expect(r.promoted).toHaveLength(1)
  })

  it('(unit 1b) dedup vs an OPEN issue → skipped, not re-filed', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const f = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'recheck this' }
    const h = fp(f)
    writeShard(dir, 'a', [{ ...f, severity: 'high', fingerprint: h }])
    const { deps, created } = makeDeps({
      searchTable: { [h]: { issueNumber: 42, state: 'open' } },
    })
    const r = runFindingsPromote({ dir }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(created).toHaveLength(0)
    expect(r.skipped.map((s) => s.fingerprint)).toContain(h)
  })

  it('severity → priority label mapping (high=P0, med=P1, low=P2) + finding+tech-debt labels', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const f = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'critical thing' }
    writeShard(dir, 'a', [{ ...f, severity: 'high', fingerprint: fp(f) }])
    const { deps, created } = makeDeps()
    const r = runFindingsPromote({ dir }, deps)
    expect(r.ok).toBe(true)
    expect(created[0]?.labels).toEqual(['finding', 'tech-debt', 'priority/P0'])
  })

  it('embeds the arbiter-fp marker in the issue body', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const f = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'thing' }
    const h = fp(f)
    writeShard(dir, 'a', [{ ...f, severity: 'med', fingerprint: h }])
    const { deps, created } = makeDeps()
    runFindingsPromote({ dir }, deps)
    expect(created[0]?.body).toContain(`<!-- arbiter-fp:${h} -->`)
  })

  it('(unit 3) promoted issue recorded to evidence tech-debt.json → gen-gap picks it up', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const f = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'thing' }
    writeShard(dir, 'a', [{ ...f, severity: 'low', fingerprint: fp(f) }])
    const { deps } = makeDeps({ createIssue: () => ({ ok: true, issueNumber: 9001 }) })
    const r = runFindingsPromote({ dir }, deps)
    expect(r.ok).toBe(true)
    const tdPath = join(dir, '.arbiter', 'evidence', 'findings-promote', 'tech-debt.json')
    expect(existsSync(tdPath)).toBe(true)
    const td = JSON.parse(readFileSync(tdPath, 'utf-8')) as { issues: number[] }
    expect(td.issues).toContain(9001)
  })

  it('symbol-only finding with NO graph → NOT bare-grep-dropped; routed to age-sweep (defer when young)', () => {
    const dir = tmpRepo()
    // No file field at all, so the file-missing rung does not apply.
    const f = { kind: 'smell', file: '', symbol: 'helperX', note: 'duplicated logic' }
    const recent = new Date().toISOString()
    writeShard(dir, 'a', [{ ...f, severity: 'low', fingerprint: fp(f), ts: recent }])
    const { deps, created } = makeDeps({ graphFresh: () => false })
    const r = runFindingsPromote({ dir, ageSweepDays: 14, now: new Date() }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // young + low-confidence → deferred, NOT dropped, NOT filed
    expect(created).toHaveLength(0)
    expect(r.dropped).toHaveLength(0)
    expect(r.deferred.map((d) => d.fingerprint)).toContain(fp(f))
  })

  it('age-sweep: low-confidence finding OLDER than threshold → promoted', () => {
    const dir = tmpRepo()
    const f = { kind: 'smell', file: '', symbol: 'helperX', note: 'old duplicated logic' }
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    writeShard(dir, 'a', [{ ...f, severity: 'low', fingerprint: fp(f), ts: old }])
    const { deps, created } = makeDeps({ graphFresh: () => false })
    const r = runFindingsPromote({ dir, ageSweepDays: 14, now: new Date() }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(created).toHaveLength(1)
    expect(r.promoted.map((p) => p.fingerprint)).toContain(fp(f))
  })

  it('graphNode present + graph fresh + node GONE → dropped', () => {
    const dir = tmpRepo()
    const f = { kind: 'risk', file: '', symbol: 'gone', note: 'node removed' }
    writeShard(dir, 'a', [
      { ...f, severity: 'high', fingerprint: fp(f), graphNode: 'src/x.ts#gone' },
    ])
    const { deps, created } = makeDeps({
      graphFresh: () => true,
      graphHasNode: () => false,
    })
    const r = runFindingsPromote({ dir }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(created).toHaveLength(0)
    expect(r.dropped.map((d) => d.fingerprint)).toContain(fp(f))
  })

  it('graphNode present + graph fresh + node PRESENT → promoted', () => {
    const dir = tmpRepo()
    const f = { kind: 'risk', file: '', symbol: 'live', note: 'node present' }
    writeShard(dir, 'a', [
      { ...f, severity: 'high', fingerprint: fp(f), graphNode: 'src/x.ts#live' },
    ])
    const { deps, created } = makeDeps({
      graphFresh: () => true,
      graphHasNode: () => true,
    })
    const r = runFindingsPromote({ dir }, deps)
    expect(r.ok).toBe(true)
    expect(created).toHaveLength(1)
  })

  it('bootstraps the finding label idempotently before filing', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const f = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'thing' }
    writeShard(dir, 'a', [{ ...f, severity: 'low', fingerprint: fp(f) }])
    let labelCalls = 0
    const { deps } = makeDeps({ ensureFindingLabel: () => labelCalls++ })
    runFindingsPromote({ dir }, deps)
    expect(labelCalls).toBe(1)
  })

  it('drains a promoted finding from its shard (spool file removed once empty)', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const f = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'thing' }
    writeShard(dir, 'a', [{ ...f, severity: 'low', fingerprint: fp(f) }])
    const { deps, created } = makeDeps()
    const r = runFindingsPromote({ dir }, deps)
    expect(r.ok).toBe(true)
    expect(created).toHaveLength(1)
    expect(existsSync(join(dir, '.arbiter', 'findings', 'a.jsonl'))).toBe(false)
  })

  it('drains a dropped finding from its shard', () => {
    const dir = tmpRepo()
    const f = { kind: 'smell', file: 'src/does-not-exist.ts', symbol: 'foo', note: 'dead helper' }
    writeShard(dir, 's1', [{ ...f, severity: 'low', fingerprint: fp(f) }])
    const { deps } = makeDeps()
    const r = runFindingsPromote({ dir }, deps)
    expect(r.ok).toBe(true)
    expect(existsSync(join(dir, '.arbiter', 'findings', 's1.jsonl'))).toBe(false)
  })

  it('drains a skipped (duplicate-of-open-issue) finding from its shard', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const f = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'thing' }
    const hash = fp(f)
    writeShard(dir, 'a', [{ ...f, severity: 'low', fingerprint: hash }])
    const { deps, created } = makeDeps({
      searchTable: { [hash]: { issueNumber: 42, state: 'open' } },
    })
    const r = runFindingsPromote({ dir }, deps)
    expect(r.ok).toBe(true)
    expect(created).toHaveLength(0)
    expect(existsSync(join(dir, '.arbiter', 'findings', 'a.jsonl'))).toBe(false)
  })

  it('keeps a deferred (young, low-confidence) finding in its shard', () => {
    const dir = tmpRepo()
    const f = { kind: 'smell', file: '', symbol: 'helperX', note: 'duplicated logic' }
    const recent = new Date().toISOString()
    writeShard(dir, 'a', [{ ...f, severity: 'low', fingerprint: fp(f), ts: recent }])
    const { deps } = makeDeps({ graphFresh: () => false })
    const r = runFindingsPromote({ dir, ageSweepDays: 14, now: new Date() }, deps)
    expect(r.ok).toBe(true)
    const shardPath = join(dir, '.arbiter', 'findings', 'a.jsonl')
    expect(existsSync(shardPath)).toBe(true)
    const remaining = readFileSync(shardPath, 'utf-8')
    expect(remaining).toContain(fp(f))
  })

  it('mixed shard: drains the resolved line, keeps the deferred line', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const resolved = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'thing' }
    const deferredF = { kind: 'smell', file: '', symbol: 'helperX', note: 'duplicated logic' }
    const recent = new Date().toISOString()
    writeShard(dir, 'a', [
      { ...resolved, severity: 'low', fingerprint: fp(resolved) },
      { ...deferredF, severity: 'low', fingerprint: fp(deferredF), ts: recent },
    ])
    const { deps, created } = makeDeps({ graphFresh: () => false })
    const r = runFindingsPromote({ dir, ageSweepDays: 14, now: new Date() }, deps)
    expect(r.ok).toBe(true)
    expect(created).toHaveLength(1)
    const shardPath = join(dir, '.arbiter', 'findings', 'a.jsonl')
    expect(existsSync(shardPath)).toBe(true)
    const remaining = readFileSync(shardPath, 'utf-8')
    expect(remaining).not.toContain(fp(resolved))
    expect(remaining).toContain(fp(deferredF))
  })
})
