// SPDX-License-Identifier: Apache-2.0
//
// #1401 — `arbiter note` per-agent JSONL finding spool.
//
// Property: a single `arbiter note` appends EXACTLY one JSON line to a per-shard spool under
// `.arbiter/findings/<shard>.jsonl`. Shards are per-active-task (parallel-safe across worktrees),
// so two concurrent notes on different shards never lose-update each other. The fingerprint is
// line-number independent and excludes ts/sha, so the SAME finding noted at line N and line N+10
// produces an IDENTICAL fingerprint (enables downstream dedup).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createTestProject, cleanupTestProject, writeTaskStateFile } from '../helpers.js'
import { runTaskNote } from '../../src/commands/task-note.js'

function findingsDir(dir: string): string {
  return join(dir, '.arbiter', 'findings')
}

function readAllFindings(dir: string): Array<Record<string, unknown>> {
  const fd = findingsDir(dir)
  if (!existsSync(fd)) return []
  const out: Array<Record<string, unknown>> = []
  for (const f of readdirSync(fd)) {
    if (!f.endsWith('.jsonl')) continue
    const raw = readFileSync(join(fd, f), 'utf-8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (t.length === 0) continue
      out.push(JSON.parse(t) as Record<string, unknown>)
    }
  }
  return out
}

describe('arbiter note — per-agent JSONL finding spool (#1401)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    writeTaskStateFile(dir, { taskId: '#1401', phase: 'green' })
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('(f) appends exactly one JSONL line and returns success (exit-0 semantics)', () => {
    const result = runTaskNote({ dir, note: 'duplicate helper in foo.ts', kind: 'dup', severity: 'low' })
    expect(result.ok).toBe(true)
    const all = readAllFindings(dir)
    expect(all).toHaveLength(1)
    expect(all[0]?.note).toBe('duplicate helper in foo.ts')
  })

  it('(e) auto-populates metadata: ts, kind, severity, foundDuring, fingerprint', () => {
    runTaskNote({ dir, note: 'risky cast', kind: 'risk', severity: 'med', file: 'src/x.ts', line: 12 })
    const [entry] = readAllFindings(dir)
    expect(entry).toBeDefined()
    expect(typeof entry?.ts).toBe('string')
    expect(entry?.kind).toBe('risk')
    expect(entry?.severity).toBe('med')
    // foundDuring is the active task id from .claude/.task/status.json
    expect(entry?.foundDuring).toBe('#1401')
    expect(entry?.file).toBe('src/x.ts')
    expect(entry?.line).toBe(12)
    expect(typeof entry?.fingerprint).toBe('string')
    expect((entry?.fingerprint as string).length).toBeGreaterThan(0)
    // graphNode is optional — omitted when absent (not present as a key)
    expect('graphNode' in (entry ?? {})).toBe(false)
  })

  it('(a) two concurrent appends to DIFFERENT shards both survive (no lost update)', () => {
    // Distinct active-task shards: simulate two worktrees by overriding the shard via taskId.
    runTaskNote({ dir, note: 'finding A', shardOverride: 'shard-A' })
    runTaskNote({ dir, note: 'finding B', shardOverride: 'shard-B' })
    const fd = findingsDir(dir)
    expect(existsSync(join(fd, 'shard-A.jsonl'))).toBe(true)
    expect(existsSync(join(fd, 'shard-B.jsonl'))).toBe(true)
    const all = readAllFindings(dir)
    const notes = all.map((e) => e.note).sort()
    expect(notes).toEqual(['finding A', 'finding B'])
  })

  it('(b) same finding at line N vs N+10 → IDENTICAL fingerprint', () => {
    runTaskNote({ dir, note: 'magic number', kind: 'smell', file: 'src/y.ts', line: 5 })
    runTaskNote({ dir, note: 'magic number', kind: 'smell', file: 'src/y.ts', line: 15 })
    const all = readAllFindings(dir)
    expect(all).toHaveLength(2)
    expect(all[0]?.fingerprint).toBe(all[1]?.fingerprint)
  })

  it('(c) notes differing only in trailing/inner whitespace → identical fingerprint', () => {
    runTaskNote({ dir, note: 'collapse   me', kind: 'smell', file: 'src/z.ts', shardOverride: 's1' })
    runTaskNote({ dir, note: '  collapse me  ', kind: 'smell', file: 'src/z.ts', shardOverride: 's2' })
    const all = readAllFindings(dir)
    expect(all).toHaveLength(2)
    expect(all[0]?.fingerprint).toBe(all[1]?.fingerprint)
  })

  it('(d) ts and sha never affect the fingerprint', () => {
    runTaskNote({ dir, note: 'same finding', kind: 'dup', file: 'src/a.ts', line: 1 })
    // second run a moment later (different ts) and a forced different sha — fingerprint must match
    runTaskNote({ dir, note: 'same finding', kind: 'dup', file: 'src/a.ts', line: 99, shaOverride: 'deadbeef' })
    const all = readAllFindings(dir)
    expect(all).toHaveLength(2)
    // ts differs run-to-run but fingerprint is stable
    expect(all[0]?.fingerprint).toBe(all[1]?.fingerprint)
    // sha is recorded but excluded from the fingerprint
    expect(all[1]?.sha).toBe('deadbeef')
  })

  it('fingerprint is case-sensitive (NO lowercasing of the note)', () => {
    runTaskNote({ dir, note: 'Foo', kind: 'x', file: 'src/c.ts', shardOverride: 'c1' })
    runTaskNote({ dir, note: 'foo', kind: 'x', file: 'src/c.ts', shardOverride: 'c2' })
    const all = readAllFindings(dir)
    expect(all[0]?.fingerprint).not.toBe(all[1]?.fingerprint)
  })
})
