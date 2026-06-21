// SPDX-License-Identifier: Apache-2.0
//
// Branch-coverage climb for src/commands/task-note.ts (#1486).
//
// Targets every conditional in the module that the behaviour-suite
// (__tests__/commands/task-note.test.ts) does not exercise:
//   - resolveShard: empty shardOverride, taskId fallback, branch fallback, anon-random fallback
//   - normalizePath: undefined, empty, backslash, leading "./"
//   - buildEntry: graphNode present / empty / absent; kind/symbol/file/line/sha defaults
//   - runTaskNote: empty-note guard, kind/severity enum guards, mkdir/append catch path
//
// git-checks.js is mocked so currentBranch/headSha are deterministic and NO real `git`
// process is ever spawned (the runner can never hang on a missing/installed CLI).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Deterministic, no-spawn git seam. Default: a real branch + a fixed sha. Individual tests
// override the return values via vi.mocked to drive resolveShard / buildEntry branches.
vi.mock('../../src/evidence/git-checks.js', () => ({
  currentBranch: vi.fn().mockReturnValue('task/#1486-branch-climb'),
  headSha: vi.fn().mockReturnValue('cafef00d'),
}))

import { runTaskNote, type TaskNoteOptions } from '../../src/commands/task-note.js'
import { currentBranch, headSha } from '../../src/evidence/git-checks.js'

// ─── temp-dir lifecycle ──────────────────────────────────────────────────────────────────────

const dirs: string[] = []

function makeDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'arbiter-task-note-cov-'))
  dirs.push(d)
  return d
}

/** Seed the unified task document so readTaskId(dir) resolves to `taskId` (or to undefined). */
function writeTaskId(dir: string, taskId: string): void {
  const taskDir = join(dir, '.claude', '.task')
  mkdirSync(taskDir, { recursive: true })
  const status = {
    taskId,
    phase: 'green',
    tier: '',
    plan: '',
    cursor: { tddPhase: null, lastAction: '', nextAction: '' },
    handoffStrategy: null,
    handoffReady: false,
    runId: 'test',
    timestamps: {},
    gateDecisions: [],
  }
  writeFileSync(join(taskDir, 'status.json'), JSON.stringify(status, null, 2) + '\n')
}

function findingsDir(dir: string): string {
  return join(dir, '.arbiter', 'findings')
}

/** All parsed finding entries across every shard file under .arbiter/findings/. */
function readAllFindings(dir: string): Array<Record<string, unknown>> {
  const fd = findingsDir(dir)
  if (!existsSync(fd)) return []
  const out: Array<Record<string, unknown>> = []
  for (const f of readShardNames(dir)) {
    const raw = readFileSync(join(fd, f), 'utf-8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (t.length === 0) continue
      out.push(JSON.parse(t) as Record<string, unknown>)
    }
  }
  return out
}

/** Names of the per-shard *.jsonl files (proves which shard runTaskNote chose). */
function readShardNames(dir: string): string[] {
  const fd = findingsDir(dir)
  if (!existsSync(fd)) return []
  return readdirSync(fd).filter((f: string): boolean => f.endsWith('.jsonl'))
}

const mockedBranch = vi.mocked(currentBranch)
const mockedHeadSha = vi.mocked(headSha)

beforeEach(() => {
  mockedBranch.mockReturnValue('task/#1486-branch-climb')
  mockedHeadSha.mockReturnValue('cafef00d')
})

afterEach(() => {
  vi.clearAllMocks()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

// ─── resolveShard branch matrix ────────────────────────────────────────────────────────────────

describe('runTaskNote — resolveShard branch matrix', () => {
  it('empty-string shardOverride falls through to the next key (does NOT use override)', () => {
    const dir = makeDir()
    writeTaskId(dir, '#777')
    // shardOverride === '' (length 0) must be ignored → taskId shard wins.
    const r = runTaskNote({ dir, note: 'empty override', shardOverride: '' })
    expect(r.ok).toBe(true)
    // taskId '#777' sanitized → shard file present; NOT a 'anon-' or branch shard.
    const shards = readShardNames(dir)
    expect(shards).toHaveLength(1)
    expect(shards[0]).not.toMatch(/^anon-/)
  })

  it('non-empty shardOverride wins over taskId and branch', () => {
    const dir = makeDir()
    writeTaskId(dir, '#777')
    const r = runTaskNote({ dir, note: 'explicit shard', shardOverride: 'shard/Explicit' })
    expect(r.ok).toBe(true)
    const shards = readShardNames(dir)
    expect(shards).toHaveLength(1)
    // sanitizeTaskId replaces unsafe chars; the file must NOT be the branch/anon shard.
    expect(shards[0]).not.toMatch(/^anon-/)
    expect(shards[0]).not.toMatch(/branch-climb/)
  })

  it('no override + present taskId uses the taskId shard', () => {
    const dir = makeDir()
    writeTaskId(dir, '#1486')
    const r = runTaskNote({ dir, note: 'task shard' })
    expect(r.ok).toBe(true)
    const shards = readShardNames(dir)
    expect(shards).toHaveLength(1)
    expect(shards[0]).not.toMatch(/^anon-/)
  })

  it('no override + no taskId + real branch → branch shard (not anon)', () => {
    const dir = makeDir()
    // No task state written → readTaskId(dir) returns undefined → branch fallback.
    mockedBranch.mockReturnValue('feature/my-branch')
    const r = runTaskNote({ dir, note: 'branch shard' })
    expect(r.ok).toBe(true)
    const shards = readShardNames(dir)
    expect(shards).toHaveLength(1)
    expect(shards[0]).not.toMatch(/^anon-/)
  })

  it('no override + no taskId + branch "unknown" → anon-random shard', () => {
    const dir = makeDir()
    mockedBranch.mockReturnValue('unknown')
    const r = runTaskNote({ dir, note: 'anon shard A' })
    expect(r.ok).toBe(true)
    const shards = readShardNames(dir)
    expect(shards).toHaveLength(1)
    expect(shards[0]).toMatch(/^anon-[0-9a-f]{8}\.jsonl$/)
  })

  it('no override + no taskId + EMPTY branch string → anon-random shard', () => {
    const dir = makeDir()
    // Empty (length 0) branch must also take the anon fallback, not become an empty shard name.
    mockedBranch.mockReturnValue('')
    const r = runTaskNote({ dir, note: 'anon shard B' })
    expect(r.ok).toBe(true)
    const shards = readShardNames(dir)
    expect(shards).toHaveLength(1)
    expect(shards[0]).toMatch(/^anon-[0-9a-f]{8}\.jsonl$/)
  })

  it('two anon notes land in DISTINCT random shards (no collision)', () => {
    const dir = makeDir()
    mockedBranch.mockReturnValue('unknown')
    runTaskNote({ dir, note: 'one' })
    runTaskNote({ dir, note: 'two' })
    const shards = readShardNames(dir).sort()
    expect(shards).toHaveLength(2)
    expect(shards[0]).not.toBe(shards[1])
  })
})

// ─── buildEntry branch matrix ───────────────────────────────────────────────────────────────────

describe('runTaskNote — buildEntry field defaulting & graphNode omission', () => {
  it('omits graphNode when absent (key not present)', () => {
    const dir = makeDir()
    writeTaskId(dir, '#1486')
    runTaskNote({ dir, note: 'no graph' })
    const [e] = readAllFindings(dir)
    expect(e).toBeDefined()
    expect('graphNode' in (e ?? {})).toBe(false)
  })

  it('omits graphNode when present-but-empty-string', () => {
    const dir = makeDir()
    writeTaskId(dir, '#1486')
    runTaskNote({ dir, note: 'empty graph', graphNode: '' })
    const [e] = readAllFindings(dir)
    expect('graphNode' in (e ?? {})).toBe(false)
  })

  it('includes graphNode when present and non-empty', () => {
    const dir = makeDir()
    writeTaskId(dir, '#1486')
    runTaskNote({ dir, note: 'with graph', graphNode: 'node-42' })
    const [e] = readAllFindings(dir)
    expect(e?.graphNode).toBe('node-42')
  })

  it('applies all defaults when kind/severity/file/line/symbol are omitted', () => {
    const dir = makeDir()
    writeTaskId(dir, '#1486')
    runTaskNote({ dir, note: 'bare note' })
    const [e] = readAllFindings(dir)
    expect(e?.kind).toBe('note')
    expect(e?.severity).toBe('info')
    expect(e?.file).toBe('')
    expect(e?.line).toBe(null)
    expect(e?.foundDuring).toBe('#1486')
  })

  it('foundDuring is "unknown" when there is no active task id', () => {
    const dir = makeDir()
    // No task state → readTaskId undefined → foundDuring falls back to 'unknown'.
    mockedBranch.mockReturnValue('feature/x')
    runTaskNote({ dir, note: 'orphan finding' })
    const [e] = readAllFindings(dir)
    expect(e?.foundDuring).toBe('unknown')
  })

  it('records headSha() when shaOverride is absent', () => {
    const dir = makeDir()
    writeTaskId(dir, '#1486')
    mockedHeadSha.mockReturnValue('abc123sha')
    runTaskNote({ dir, note: 'sha from head' })
    const [e] = readAllFindings(dir)
    expect(e?.sha).toBe('abc123sha')
  })

  it('records shaOverride verbatim when provided (headSha not consulted)', () => {
    const dir = makeDir()
    writeTaskId(dir, '#1486')
    runTaskNote({ dir, note: 'forced sha', shaOverride: 'deadbeef' })
    const [e] = readAllFindings(dir)
    expect(e?.sha).toBe('deadbeef')
    expect(mockedHeadSha).not.toHaveBeenCalled()
  })

  it('normalizes a Windows-style path with backslashes and "./" prefix', () => {
    const dir = makeDir()
    writeTaskId(dir, '#1486')
    runTaskNote({ dir, note: 'win path', file: '.\\src\\sub\\thing.ts' })
    const [e] = readAllFindings(dir)
    expect(e?.file).toBe('src/sub/thing.ts')
  })

  it('symbol participates in the fingerprint (same note+file, different symbol → differs)', () => {
    const dir = makeDir()
    writeTaskId(dir, '#1486')
    runTaskNote({ dir, note: 'same', file: 'a.ts', symbol: 'fnA', shardOverride: 'a1' })
    runTaskNote({ dir, note: 'same', file: 'a.ts', symbol: 'fnB', shardOverride: 'a2' })
    const all = readAllFindings(dir)
    expect(all).toHaveLength(2)
    expect(all[0]?.fingerprint).not.toBe(all[1]?.fingerprint)
  })
})

// ─── validation guards ──────────────────────────────────────────────────────────────────────────

describe('runTaskNote — validation guard branches', () => {
  it('rejects an empty note (whitespace-only) and writes nothing', () => {
    const dir = makeDir()
    writeTaskId(dir, '#1486')
    const r = runTaskNote({ dir, note: '   \t\n  ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/empty/i)
    expect(existsSync(findingsDir(dir))).toBe(false)
  })

  it('rejects an out-of-enum kind before any spool write', () => {
    const dir = makeDir()
    writeTaskId(dir, '#1486')
    const r = runTaskNote({ dir, note: 'x', kind: 'totally-bogus' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/kind/i)
    expect(readAllFindings(dir)).toHaveLength(0)
  })

  it('rejects an out-of-enum severity before any spool write', () => {
    const dir = makeDir()
    writeTaskId(dir, '#1486')
    const r = runTaskNote({ dir, note: 'x', kind: 'risk', severity: 'nuclear' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/severity/i)
    expect(readAllFindings(dir)).toHaveLength(0)
  })

  it('accepts a defined-but-valid kind AND severity together', () => {
    const dir = makeDir()
    writeTaskId(dir, '#1486')
    const r = runTaskNote({ dir, note: 'ok', kind: 'debt', severity: 'high' })
    expect(r.ok).toBe(true)
    const [e] = readAllFindings(dir)
    expect(e?.kind).toBe('debt')
    expect(e?.severity).toBe('high')
  })

  it('defaults dir to process.cwd() when opts.dir is omitted', () => {
    // Run inside an empty temp cwd so the spool lands there, not in the repo tree.
    const dir = makeDir()
    const prev = process.cwd()
    try {
      process.chdir(dir)
      mockedBranch.mockReturnValue('unknown')
      const opts: TaskNoteOptions = { note: 'cwd default' }
      const r = runTaskNote(opts)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.spoolPath.startsWith(dir)).toBe(true)
    } finally {
      process.chdir(prev)
    }
  })
})

// ─── spool write failure (catch path) ────────────────────────────────────────────────────────────

describe('runTaskNote — spool write failure surfaces a clean failure result', () => {
  it('returns ok:false with a reason when the findings dir cannot be created', () => {
    const dir = makeDir()
    writeTaskId(dir, '#1486')
    // Make `.arbiter` a FILE so mkdirSync('.arbiter/findings', recursive) throws ENOTDIR/EEXIST.
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    rmSync(join(dir, '.arbiter'), { recursive: true, force: true })
    writeFileSync(join(dir, '.arbiter'), 'not a directory')
    const r = runTaskNote({ dir, note: 'doomed write' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/findings spool write failed/i)
  })
})
