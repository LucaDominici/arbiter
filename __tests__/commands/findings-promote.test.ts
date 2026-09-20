// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { describe, it, expect, afterEach, vi } from 'vitest'

const { mockRunCli } = vi.hoisted(() => ({ mockRunCli: vi.fn() }))

vi.mock('../../src/utils/run-cli.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/utils/run-cli.js')>()),
  runCli: mockRunCli,
}))

import { findingOperations } from '../../src/findings/operations.js'

const { promote: runFindingsPromote, triage: runFindingsTriage } = findingOperations
type PromoteDeps = Parameters<typeof runFindingsPromote>[1]
type IssueSearchResult = NonNullable<ReturnType<PromoteDeps['searchIssueByFingerprint']>>

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
    mockRunCli.mockReset()
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

  it('malformed spool data fails closed instead of reporting an empty success', () => {
    const dir = tmpRepo()
    const findingsDir = join(dir, '.arbiter', 'findings')
    mkdirSync(findingsDir, { recursive: true })
    writeFileSync(join(findingsDir, 'broken.jsonl'), '{not json}\n', 'utf-8')
    const { deps } = makeDeps()

    expect(() => runFindingsPromote({ dir }, deps)).toThrow('broken.jsonl:1')
  })

  it('schema-invalid spool data fails closed instead of being silently discarded', () => {
    const dir = tmpRepo()
    const findingsDir = join(dir, '.arbiter', 'findings')
    mkdirSync(findingsDir, { recursive: true })
    writeFileSync(
      join(findingsDir, 'incomplete.jsonl'),
      `${JSON.stringify({ fingerprint: 'abc', note: 'missing required fields' })}\n`,
      'utf-8',
    )
    const { deps } = makeDeps()

    expect(() => runFindingsPromote({ dir }, deps)).toThrow(/incomplete\.jsonl:1.*schema/i)
  })

  it.each(['{}', '[{"state":"OPEN"}]'])(
    'malformed GitHub issue search shape fails closed: %s',
    (stdout) => {
      mockRunCli.mockReturnValue({ stdout, stderr: '', exitCode: 0, durationMs: 1 })

      expect(() => findingOperations.defaultDeps.searchIssueByFingerprint('/tmp', 'abc')).toThrow(
        /malformed.*issue search/i,
      )
    },
  )

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

  it('issue lookup failure aborts promotion instead of risking a duplicate', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const f = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'recheck this' }
    writeShard(dir, 'a', [{ ...f, severity: 'high', fingerprint: fp(f) }])
    const { deps, created } = makeDeps({
      searchIssueByFingerprint: () => {
        throw new Error('GitHub unavailable')
      },
    })

    expect(() => runFindingsPromote({ dir }, deps)).toThrow('GitHub unavailable')
    expect(created).toHaveLength(0)
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

  it('triages the existing spool without writing: live, stale, and low-confidence stay distinct', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'live.ts'), 'export const live = true\n', 'utf-8')
    const live = { kind: 'risk', file: 'live.ts', symbol: 'live', note: 'live finding' }
    const stale = { kind: 'risk', file: 'gone.ts', symbol: 'gone', note: 'stale finding' }
    const uncertain = { kind: 'risk', file: '', symbol: 'maybe', note: 'uncertain finding' }
    writeShard(dir, 'a', [
      { ...live, severity: 'high', fingerprint: fp(live) },
      { ...stale, severity: 'low', fingerprint: fp(stale) },
      { ...uncertain, severity: 'med', fingerprint: fp(uncertain) },
    ])
    const spool = join(dir, '.arbiter', 'findings', 'a.jsonl')
    const before = readFileSync(spool, 'utf-8')
    const { deps } = makeDeps({ graphFresh: () => false })

    const result = runFindingsTriage({ dir, now: new Date('2026-06-16T00:00:00.000Z') }, deps)

    expect(result.map(({ disposition }) => disposition)).toEqual(['READY', 'STALE', 'DEFERRED'])
    expect(readFileSync(spool, 'utf-8')).toBe(before)
  })

  // ─── #2733: promote drains what it durably resolved ────────────────────────
  // The spool is the SSOT for STILL-OPEN findings (debt-lib collectFindingsMetrics
  // and the stop-finding-loss hook both read it). Leaving promoted entries behind
  // made capture-then-promote permanently red on the debt ratchet.

  function drainReceipt(dir: string): Array<Record<string, unknown>> {
    const p = join(dir, '.arbiter', 'evidence', 'findings-promote', 'drained.jsonl')
    if (!existsSync(p)) return []
    return readFileSync(p, 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
  }

  it('(#2733 AC-1) a filed finding is removed from its spool shard', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const finding = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'promote me' }
    const h = fp(finding)
    writeShard(dir, 'a', [{ ...finding, severity: 'high', fingerprint: h }])
    const { deps } = makeDeps()

    const r = runFindingsPromote({ dir }, deps)

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.drained.map((d) => d.fingerprint)).toEqual([h])
    expect(readFileSync(join(dir, '.arbiter', 'findings', 'a.jsonl'), 'utf-8')).not.toContain(h)
  })

  it('(#2733 AC-2) drains stale and open-issue findings; keeps cooldown and deferred ones', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const stale = { kind: 'risk', file: 'gone.ts', symbol: 'y', note: 'stale' }
    const tracked = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'already tracked' }
    const cooldown = { kind: 'risk', file: 'real.ts', symbol: 'z', note: 'closed recently' }
    const deferred = { kind: 'smell', file: '', symbol: 'helperX', note: 'young low-confidence' }
    const now = new Date('2026-06-16T00:00:00.000Z')
    writeShard(dir, 'a', [
      { ...stale, severity: 'low', fingerprint: fp(stale) },
      { ...tracked, severity: 'low', fingerprint: fp(tracked) },
      { ...cooldown, severity: 'low', fingerprint: fp(cooldown) },
      { ...deferred, severity: 'low', fingerprint: fp(deferred), ts: now.toISOString() },
    ])
    const { deps } = makeDeps({
      searchTable: {
        [fp(tracked)]: { issueNumber: 42, state: 'open' },
        [fp(cooldown)]: { issueNumber: 43, state: 'closed', closedAt: '2026-06-10T00:00:00.000Z' },
      },
    })

    const r = runFindingsPromote({ dir, now }, deps)

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.drained.map((d) => d.fingerprint).sort()).toEqual([fp(stale), fp(tracked)].sort())
    // Each drain carries its OWN disposition, so a regression that labelled everything
    // `promoted` would be visible here.
    expect(
      Object.fromEntries(drainReceipt(dir).map((rec) => [rec['fingerprint'], rec['disposition']])),
    ).toEqual({ [fp(stale)]: 'dropped', [fp(tracked)]: 'tracked' })
    const spool = readFileSync(join(dir, '.arbiter', 'findings', 'a.jsonl'), 'utf-8')
    expect(spool).not.toContain(fp(stale))
    expect(spool).not.toContain(fp(tracked))
    // Cooldown findings are durable NOWHERE: dropping one would delete the finding
    // for good, since after the 30-day cooldown there would be nothing to re-promote.
    expect(spool).toContain(fp(cooldown))
    expect(spool).toContain(fp(deferred))
  })

  it('(#2733 AC-3) openFindingsCount falls to 0 once the spool is fully drained', async () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const finding = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'count me' }
    writeShard(dir, 'a', [{ ...finding, severity: 'high', fingerprint: fp(finding) }])
    const { collectFindingsMetrics } = await import('../../scripts/debt-lib.mjs')
    expect(collectFindingsMetrics(dir).openFindingsCount?.value).toBe(1)

    runFindingsPromote({ dir }, makeDeps().deps)

    expect(collectFindingsMetrics(dir).openFindingsCount?.value).toBe(0)
  })

  it('(#2733 AC-4) records each drain in drained.jsonl without changing tech-debt.json', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const finding = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'receipt me' }
    const h = fp(finding)
    writeShard(dir, 'a', [{ ...finding, severity: 'low', fingerprint: h }])
    const { deps } = makeDeps({ createIssue: () => ({ ok: true, issueNumber: 9001 }) })

    runFindingsPromote({ dir }, deps)

    const receipt = drainReceipt(dir)
    expect(receipt).toHaveLength(1)
    expect(receipt[0]).toMatchObject({ fingerprint: h, issue: 9001, disposition: 'promoted' })
    expect(Number.isNaN(Date.parse(String(receipt[0]?.ts)))).toBe(false)
    // capturedTs is the FINDING's clock, so the Stop hook can tell a finding this session
    // captured from an older one this session merely promoted.
    expect(receipt[0]?.capturedTs).toBe('2026-06-16T00:00:00.000Z')
    // The receipt keeps the whole spool line — a DROPPED finding survives nowhere else,
    // so a false drop (e.g. the file was renamed) stays recoverable.
    expect(receipt[0]?.finding).toMatchObject({ note: 'receipt me', file: 'real.ts' })
    const tdPath = join(dir, '.arbiter', 'evidence', 'findings-promote', 'tech-debt.json')
    expect(JSON.parse(readFileSync(tdPath, 'utf-8'))).toEqual({ issues: [9001] })
  })

  it('(#2733 AC-6) a failed issue creation drains nothing', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const finding = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'will fail' }
    writeShard(dir, 'a', [{ ...finding, severity: 'low', fingerprint: fp(finding) }])
    const spool = join(dir, '.arbiter', 'findings', 'a.jsonl')
    const before = readFileSync(spool, 'utf-8')
    const { deps } = makeDeps({ createIssue: () => ({ ok: false, reason: 'gh exploded' }) })

    const r = runFindingsPromote({ dir }, deps)

    expect(r.ok).toBe(false)
    expect(readFileSync(spool, 'utf-8')).toBe(before)
    expect(drainReceipt(dir)).toEqual([])
  })

  it('(#2733) a shard that lost nothing is left byte-identical', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const promoted = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'promote me' }
    const young = { kind: 'smell', file: '', symbol: 'helperX', note: 'young low-confidence' }
    const now = new Date('2026-06-16T00:00:00.000Z')
    writeShard(dir, 'a', [{ ...promoted, severity: 'high', fingerprint: fp(promoted) }])
    writeShard(dir, 'b', [
      { ...young, severity: 'low', fingerprint: fp(young), ts: now.toISOString() },
    ])
    const other = join(dir, '.arbiter', 'findings', 'b.jsonl')
    const before = readFileSync(other, 'utf-8')

    runFindingsPromote({ dir, now }, makeDeps().deps)

    // Per-shard files exist so concurrent `finding add` calls never contend; rewriting a
    // shard the drain did not touch would throw that isolation away.
    expect(readFileSync(other, 'utf-8')).toBe(before)
  })

  it('(#2733 AC-7) malformed spool data aborts the run before anything is deleted', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const finding = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'promote me' }
    writeShard(dir, 'a', [{ ...finding, severity: 'high', fingerprint: fp(finding) }])
    // A shard holding a line readSpool rejects: the run fails closed BEFORE any
    // drain, so the unreadable content is still there afterwards.
    const junk = join(dir, '.arbiter', 'findings', 'b.jsonl')
    writeFileSync(junk, 'not json at all\n', 'utf-8')

    expect(() => runFindingsPromote({ dir }, makeDeps().deps)).toThrow()
    expect(readFileSync(junk, 'utf-8')).toBe('not json at all\n')
    expect(drainReceipt(dir)).toEqual([])
  })

  it('(#2733 AC-7) a line appended mid-run, after the spool was read, is never deleted', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const finding = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'promote me' }
    const h = fp(finding)
    const shard = join(dir, '.arbiter', 'findings', 'a.jsonl')
    writeShard(dir, 'a', [{ ...finding, severity: 'high', fingerprint: h }])
    // The drain re-reads the spool after the filing loop, so a concurrent `arbiter finding
    // add` lands between the two reads — including a half-written line. The drain must keep
    // what it cannot parse and still remove the fingerprint it proved durable.
    const { deps } = makeDeps({
      createIssue: () => {
        writeFileSync(shard, readFileSync(shard, 'utf-8') + '{"ts":"2026-06-16T00:00', 'utf-8')
        return { ok: true, issueNumber: 7007 }
      },
    })

    const r = runFindingsPromote({ dir }, deps)

    expect(r.ok).toBe(true)
    const after = readFileSync(shard, 'utf-8')
    expect(after).toContain('{"ts":"2026-06-16T00:00')
    expect(after).not.toContain(h)
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
})
