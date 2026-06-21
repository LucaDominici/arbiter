// SPDX-License-Identifier: Apache-2.0
//
// Coverage-raising unit test for src/commands/findings-promote.ts.
//
// The existing __tests__/commands/findings-promote.test.ts exercises the pure
// orchestrator runFindingsPromote() with injected stub deps. This file fills the
// remaining gaps:
//   - listSpoolFindings() (read + within-spool dedup, malformed-line skipping)
//   - the recentlyClosed cooldown branches reached through the orchestrator
//   - createIssue soft-fail (result.ok === false) keeps draining the rest
//   - the buildBody variants (line null vs set, graphNode absent vs present, file none)
//   - the PRODUCTION defaultPromoteDeps wiring (real gh / git / graph snapshot),
//     driven hermetically by putting fake `gh`/`git` executables on a temp PATH.
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  chmodSync,
  readFileSync,
  existsSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir, platform } from 'node:os'
import { createHash } from 'node:crypto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  listSpoolFindings,
  runFindingsPromote,
  defaultPromoteDeps,
  type PromoteDeps,
  type IssueSearchResult,
  type SpoolFinding,
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

function spoolLine(f: MiniFinding): string {
  return JSON.stringify({
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
  })
}

const dirs: string[] = []

function tmpRepo(): string {
  const d = mkdtempSync(join(tmpdir(), 'findings-promote-cov-'))
  dirs.push(d)
  return d
}

function writeRawShard(dir: string, shard: string, lines: string[]): void {
  const fdir = join(dir, '.arbiter', 'findings')
  mkdirSync(fdir, { recursive: true })
  writeFileSync(join(fdir, `${shard}.jsonl`), lines.join('\n') + '\n', 'utf-8')
}

function writeShard(dir: string, shard: string, findings: MiniFinding[]): void {
  writeRawShard(
    dir,
    shard,
    findings.map((f) => spoolLine(f)),
  )
}

/** Stub deps mirroring the production-shaped contract but answering deterministically. */
function makeStubDeps(
  overrides: Partial<PromoteDeps> & { searchTable?: Record<string, IssueSearchResult> } = {},
): { deps: PromoteDeps; created: Array<{ labels: readonly string[]; body: string }> } {
  const created: Array<{ labels: readonly string[]; body: string }> = []
  let next = 7000
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

afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

describe('listSpoolFindings()', () => {
  it('returns [] when the spool directory is absent', () => {
    const dir = tmpRepo()
    expect(listSpoolFindings(dir)).toEqual([])
  })

  it('reads across shards, dedups by fingerprint, and skips malformed/blank lines', () => {
    const dir = tmpRepo()
    const a = { kind: 'smell', file: 'a.ts', symbol: 's', note: 'alpha' }
    const b = { kind: 'risk', file: 'b.ts', symbol: 't', note: 'beta' }
    const ha = fp(a)
    const hb = fp(b)
    // shard "z" sorts after "a"; first occurrence (in sorted order) wins for dedup.
    writeRawShard(dir, 'a', [
      spoolLine({ ...a, severity: 'low', fingerprint: ha }),
      '   ', // blank → skipped
      '{ not valid json', // malformed → skipped
      JSON.stringify({ foo: 'no fingerprint field' }), // fails isSpoolFinding → skipped
    ])
    writeRawShard(dir, 'z', [
      spoolLine({ ...a, severity: 'high', fingerprint: ha }), // dup fingerprint → dropped
      spoolLine({ ...b, severity: 'med', fingerprint: hb }),
    ])
    const out = listSpoolFindings(dir)
    expect(out).toHaveLength(2)
    const fps = out.map((f) => f.fingerprint).sort()
    expect(fps).toEqual([ha, hb].sort())
    // the kept "alpha" entry is the FIRST occurrence (shard a, severity low)
    const alpha = out.find((f) => f.fingerprint === ha) as SpoolFinding
    expect(alpha.severity).toBe('low')
  })

  it('skips a line whose fingerprint/note are non-string (isSpoolFinding guard)', () => {
    const dir = tmpRepo()
    writeRawShard(dir, 's', [
      JSON.stringify({ fingerprint: 123, note: 'numeric fp' }),
      JSON.stringify({ fingerprint: 'ok', note: 42 }),
      'null',
    ])
    expect(listSpoolFindings(dir)).toEqual([])
  })
})

describe('runFindingsPromote() — orchestrator branches not covered elsewhere', () => {
  it('closed issue still within the 30-day cooldown → skipped (not re-filed)', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const f = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'cooldown' }
    const h = fp(f)
    writeShard(dir, 'a', [{ ...f, severity: 'high', fingerprint: h }])
    const now = new Date('2026-06-20T00:00:00.000Z')
    const closedAt = new Date('2026-06-10T00:00:00.000Z').toISOString() // 10 days ago < 30
    const { deps, created } = makeStubDeps({
      searchTable: { [h]: { issueNumber: 10, state: 'closed', closedAt } },
    })
    const r = runFindingsPromote({ dir, now }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(created).toHaveLength(0)
    expect(r.skipped.map((s) => s.fingerprint)).toContain(h)
  })

  it('closed issue with UNKNOWN closedAt → treated as in cooldown → skipped', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const f = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'no closedAt' }
    const h = fp(f)
    writeShard(dir, 'a', [{ ...f, severity: 'med', fingerprint: h }])
    const { deps, created } = makeStubDeps({
      searchTable: { [h]: { issueNumber: 11, state: 'closed' } },
    })
    const r = runFindingsPromote({ dir }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(created).toHaveLength(0)
    expect(r.skipped.map((s) => s.fingerprint)).toContain(h)
  })

  it('closed issue OLDER than the cooldown → re-filed (cooldown expired)', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const f = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'reopen me' }
    const h = fp(f)
    writeShard(dir, 'a', [{ ...f, severity: 'low', fingerprint: h }])
    const now = new Date('2026-06-20T00:00:00.000Z')
    const closedAt = new Date('2026-01-01T00:00:00.000Z').toISOString() // > 30 days ago
    const { deps, created } = makeStubDeps({
      searchTable: { [h]: { issueNumber: 12, state: 'closed', closedAt } },
    })
    const r = runFindingsPromote({ dir, now }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(created).toHaveLength(1)
    expect(r.promoted.map((p) => p.fingerprint)).toContain(h)
  })

  it('createIssue soft-fail (ok:false) → finding skipped, no evidence written, others continue', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'one.ts'), 'export const a = 1\n', 'utf-8')
    writeFileSync(join(dir, 'two.ts'), 'export const b = 2\n', 'utf-8')
    const f1 = { kind: 'risk', file: 'one.ts', symbol: 'a', note: 'first fails' }
    const f2 = { kind: 'risk', file: 'two.ts', symbol: 'b', note: 'second works' }
    writeShard(dir, 'a', [
      { ...f1, severity: 'high', fingerprint: fp(f1) },
      { ...f2, severity: 'low', fingerprint: fp(f2) },
    ])
    let call = 0
    const { deps } = makeStubDeps({
      createIssue: () => {
        call += 1
        return call === 1 ? { ok: false, reason: 'gh down' } : { ok: true, issueNumber: 4242 }
      },
    })
    const r = runFindingsPromote({ dir }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.skipped.map((s) => s.fingerprint)).toContain(fp(f1))
    expect(r.promoted.map((p) => p.fingerprint)).toContain(fp(f2))
    // evidence only written for the one that actually filed
    const tdPath = join(dir, '.arbiter', 'evidence', 'findings-promote', 'tech-debt.json')
    expect(existsSync(tdPath)).toBe(true)
    const td = JSON.parse(readFileSync(tdPath, 'utf-8')) as { issues: number[] }
    expect(td.issues).toEqual([4242])
  })

  it('buildBody: line present and graphNode present → both rendered in the body', () => {
    const dir = tmpRepo()
    const f = { kind: 'risk', file: '', symbol: 'live', note: 'with node and line' }
    const h = fp(f)
    writeShard(dir, 'a', [
      { ...f, severity: 'high', fingerprint: h, graphNode: 'src/x.ts#live', line: 99 },
    ])
    const { deps, created } = makeStubDeps({ graphFresh: () => true, graphHasNode: () => true })
    runFindingsPromote({ dir }, deps)
    const body = created[0]?.body ?? ''
    expect(body).toContain('- graph node: src/x.ts#live')
    expect(body).toContain(`<!-- arbiter-fp:${h} -->`)
  })

  it('buildBody: file set with a line → renders "file:line"; no graphNode line', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const f = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'has line' }
    writeShard(dir, 'a', [{ ...f, severity: 'low', fingerprint: fp(f), line: 7 }])
    const { deps, created } = makeStubDeps()
    runFindingsPromote({ dir }, deps)
    const body = created[0]?.body ?? ''
    expect(body).toContain('- file: real.ts:7')
    expect(body).not.toContain('- graph node:')
  })

  it('buildBody: no file → renders "- file: (none)"', () => {
    // age-sweep an old symbol-only finding so it promotes and we can inspect the body
    const dir = tmpRepo()
    const f = { kind: 'smell', file: '', symbol: 'helperX', note: 'no file finding' }
    const old = new Date('2026-01-01T00:00:00.000Z').toISOString()
    writeShard(dir, 'a', [{ ...f, severity: 'low', fingerprint: fp(f), ts: old }])
    const { deps, created } = makeStubDeps({ graphFresh: () => false })
    runFindingsPromote({ dir, ageSweepDays: 14, now: new Date('2026-06-20T00:00:00.000Z') }, deps)
    expect(created[0]?.body).toContain('- file: (none)')
  })

  it('severityToPriority: medium/critical/unknown map correctly', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1\n', 'utf-8')
    writeFileSync(join(dir, 'b.ts'), 'export const b = 2\n', 'utf-8')
    writeFileSync(join(dir, 'c.ts'), 'export const c = 3\n', 'utf-8')
    const fa = { kind: 'risk', file: 'a.ts', symbol: 'a', note: 'crit' }
    const fb = { kind: 'risk', file: 'b.ts', symbol: 'b', note: 'medium' }
    const fc = { kind: 'risk', file: 'c.ts', symbol: 'c', note: 'weird' }
    writeShard(dir, 's', [
      { ...fa, severity: 'critical', fingerprint: fp(fa) },
      { ...fb, severity: 'medium', fingerprint: fp(fb) },
      { ...fc, severity: 'whatever', fingerprint: fp(fc) },
    ])
    const { deps, created } = makeStubDeps()
    runFindingsPromote({ dir }, deps)
    const byNote = (n: string): readonly string[] =>
      created.find((c) => c.body.includes(n))?.labels ?? []
    expect(byNote('crit')).toContain('priority/P0')
    expect(byNote('medium')).toContain('priority/P1')
    expect(byNote('weird')).toContain('priority/P2')
  })

  it('readdir/readFile resilience: a shard read error does not crash; valid shards still drain', () => {
    const dir = tmpRepo()
    // a directory named like a shard makes readFileSync throw (EISDIR) → that shard skipped
    const fdir = join(dir, '.arbiter', 'findings')
    mkdirSync(join(fdir, 'broken.jsonl'), { recursive: true })
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const f = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'survivor' }
    writeShard(dir, 'good', [{ ...f, severity: 'low', fingerprint: fp(f) }])
    const { deps, created } = makeStubDeps()
    const r = runFindingsPromote({ dir }, deps)
    expect(r.ok).toBe(true)
    expect(created).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Production defaultPromoteDeps — driven through a fake `gh`/`git` on PATH.
// runCli uses spawnSync(shell:false) and resolves the bare command via PATH,
// so prepending a temp bin dir with executable `gh`/`git` shims is hermetic.
// Skipped on win32 where shebang shims do not execute the same way.
// ---------------------------------------------------------------------------

const onPosix = platform() !== 'win32'

/** Write an executable node-shebang shim that runs `body` (a JS program string). */
function writeShim(binDir: string, name: string, body: string): void {
  const p = join(binDir, name)
  writeFileSync(p, `#!/usr/bin/env node\n${body}\n`, 'utf-8')
  chmodSync(p, 0o755)
}

describe.skipIf(!onPosix)('defaultPromoteDeps — production gh/git/graph wiring', () => {
  let savedPath: string | undefined
  let binDir: string

  beforeEach(() => {
    savedPath = process.env['PATH']
    binDir = mkdtempSync(join(tmpdir(), 'fp-bin-'))
    dirs.push(binDir)
  })

  afterEach(() => {
    process.env['PATH'] = savedPath
  })

  function prependBin(): void {
    process.env['PATH'] = `${binDir}:${savedPath ?? ''}`
  }

  it('ensureFindingLabel: gh success path does not throw', () => {
    writeShim(binDir, 'gh', `process.exit(0)`)
    prependBin()
    const dir = tmpRepo()
    expect(() => defaultPromoteDeps.ensureFindingLabel(dir)).not.toThrow()
  })

  it('ensureFindingLabel: gh non-zero exit (CliError) is swallowed (best-effort)', () => {
    writeShim(binDir, 'gh', `process.stderr.write('boom'); process.exit(3)`)
    prependBin()
    const dir = tmpRepo()
    expect(() => defaultPromoteDeps.ensureFindingLabel(dir)).not.toThrow()
  })

  it('searchIssueByFingerprint: returns an OPEN issue from gh JSON', () => {
    writeShim(
      binDir,
      'gh',
      `process.stdout.write(JSON.stringify([{ number: 77, state: 'OPEN', closedAt: null }]))`,
    )
    prependBin()
    const dir = tmpRepo()
    const hit = defaultPromoteDeps.searchIssueByFingerprint(dir, 'abc123')
    expect(hit).not.toBeNull()
    expect(hit?.issueNumber).toBe(77)
    expect(hit?.state).toBe('open')
    expect(hit?.closedAt).toBeUndefined()
  })

  it('searchIssueByFingerprint: returns a CLOSED issue carrying closedAt', () => {
    writeShim(
      binDir,
      'gh',
      `process.stdout.write(JSON.stringify([{ number: 88, state: 'CLOSED', closedAt: '2026-05-01T00:00:00Z' }]))`,
    )
    prependBin()
    const dir = tmpRepo()
    const hit = defaultPromoteDeps.searchIssueByFingerprint(dir, 'abc')
    expect(hit?.state).toBe('closed')
    expect(hit?.closedAt).toBe('2026-05-01T00:00:00Z')
  })

  it('searchIssueByFingerprint: empty array → null', () => {
    writeShim(binDir, 'gh', `process.stdout.write('[]')`)
    prependBin()
    expect(defaultPromoteDeps.searchIssueByFingerprint(tmpRepo(), 'x')).toBeNull()
  })

  it('searchIssueByFingerprint: non-array JSON → null', () => {
    writeShim(binDir, 'gh', `process.stdout.write('{"number":1}')`)
    prependBin()
    expect(defaultPromoteDeps.searchIssueByFingerprint(tmpRepo(), 'x')).toBeNull()
  })

  it('searchIssueByFingerprint: invalid JSON → null', () => {
    writeShim(binDir, 'gh', `process.stdout.write('not json at all')`)
    prependBin()
    expect(defaultPromoteDeps.searchIssueByFingerprint(tmpRepo(), 'x')).toBeNull()
  })

  it('searchIssueByFingerprint: first element missing numeric number → null', () => {
    writeShim(binDir, 'gh', `process.stdout.write(JSON.stringify([{ state: 'open' }]))`)
    prependBin()
    expect(defaultPromoteDeps.searchIssueByFingerprint(tmpRepo(), 'x')).toBeNull()
  })

  it('searchIssueByFingerprint: gh non-zero exit (runCli throws) → null', () => {
    writeShim(binDir, 'gh', `process.exit(2)`)
    prependBin()
    expect(defaultPromoteDeps.searchIssueByFingerprint(tmpRepo(), 'x')).toBeNull()
  })

  it('searchIssueByFingerprint: closedAt empty string → omitted from result', () => {
    writeShim(
      binDir,
      'gh',
      `process.stdout.write(JSON.stringify([{ number: 5, state: 'closed', closedAt: '' }]))`,
    )
    prependBin()
    const hit = defaultPromoteDeps.searchIssueByFingerprint(tmpRepo(), 'x')
    expect(hit?.state).toBe('closed')
    expect(hit?.closedAt).toBeUndefined()
  })

  it('graphFresh: graph.json absent → false', () => {
    prependBin()
    expect(defaultPromoteDeps.graphFresh(tmpRepo())).toBe(false)
  })

  it('graphFresh: graph newer than HEAD commit time → true', () => {
    writeShim(binDir, 'git', `process.stdout.write('2000-01-01T00:00:00+00:00')`)
    prependBin()
    const dir = tmpRepo()
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(join(dir, '.arbiter', 'graph.json'), '{"nodes":[],"edges":[]}', 'utf-8')
    // graph mtime is "now" (2026) >> the 2000 HEAD time → fresh
    expect(defaultPromoteDeps.graphFresh(dir)).toBe(true)
  })

  it('graphFresh: git returns an unparseable date (NaN) → false', () => {
    writeShim(binDir, 'git', `process.stdout.write('not-a-date')`)
    prependBin()
    const dir = tmpRepo()
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(join(dir, '.arbiter', 'graph.json'), '{"nodes":[],"edges":[]}', 'utf-8')
    expect(defaultPromoteDeps.graphFresh(dir)).toBe(false)
  })

  it('graphFresh: git log fails (non-zero exit, runCli throws) → false', () => {
    writeShim(binDir, 'git', `process.exit(1)`)
    prependBin()
    const dir = tmpRepo()
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(join(dir, '.arbiter', 'graph.json'), '{"nodes":[],"edges":[]}', 'utf-8')
    expect(defaultPromoteDeps.graphFresh(dir)).toBe(false)
  })

  it('graphHasNode: returns true when the snapshot contains the node id', () => {
    const dir = tmpRepo()
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    const snap = {
      nodes: [{ id: 'src/x.ts#live', kind: 'SYMBOL', attrs: {} }],
      edges: [],
    }
    writeFileSync(join(dir, '.arbiter', 'graph.json'), JSON.stringify(snap), 'utf-8')
    expect(defaultPromoteDeps.graphHasNode(dir, 'src/x.ts#live')).toBe(true)
    expect(defaultPromoteDeps.graphHasNode(dir, 'src/x.ts#ghost')).toBe(false)
  })

  it('graphHasNode: missing snapshot → false', () => {
    const dir = tmpRepo()
    expect(defaultPromoteDeps.graphHasNode(dir, 'anything')).toBe(false)
  })

  it('createIssue: delegates to gh and parses the issue number', () => {
    writeShim(
      binDir,
      'gh',
      `process.stdout.write('https://github.com/o/r/issues/321\\n')`,
    )
    prependBin()
    const dir = tmpRepo()
    const res = defaultPromoteDeps.createIssue(dir, {
      title: 'finding: x',
      body: 'body',
      labels: ['finding', 'tech-debt', 'priority/P2'],
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.issueNumber).toBe(321)
  })

  it('end-to-end through defaultPromoteDeps: file-present finding is promoted with real shims', () => {
    // gh handles both `label create` (exit 0), `issue list` (empty → []), and
    // `issue create` (returns a URL) by inspecting argv.
    writeShim(
      binDir,
      'gh',
      [
        `const a = process.argv.slice(2)`,
        `if (a[0] === 'label') { process.exit(0) }`,
        `if (a[0] === 'issue' && a[1] === 'list') { process.stdout.write('[]'); process.exit(0) }`,
        `if (a[0] === 'issue' && a[1] === 'create') { process.stdout.write('https://github.com/o/r/issues/999\\n'); process.exit(0) }`,
        `process.exit(0)`,
      ].join('\n'),
    )
    prependBin()
    const dir = tmpRepo()
    writeFileSync(join(dir, 'real.ts'), 'export const x = 1\n', 'utf-8')
    const f = { kind: 'risk', file: 'real.ts', symbol: 'x', note: 'live finding' }
    writeShard(dir, 'a', [{ ...f, severity: 'low', fingerprint: fp(f) }])
    const r = runFindingsPromote({ dir }, defaultPromoteDeps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.promoted.map((p) => p.fingerprint)).toContain(fp(f))
    const tdPath = join(dir, '.arbiter', 'evidence', 'findings-promote', 'tech-debt.json')
    const td = JSON.parse(readFileSync(tdPath, 'utf-8')) as { issues: number[] }
    expect(td.issues).toContain(999)
  })
})
