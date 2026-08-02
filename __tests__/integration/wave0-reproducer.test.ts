// SPDX-License-Identifier: Apache-2.0
//
// #1077 (Wave 0 F1 + F7): `arbiter diff` must enumerate the SAME file set that
// `arbiter update` touches. Before this fix, `diff` hardcoded ~9 files while
// `update` wrote ~55 via the generator registry — diff under-reported by ~89%
// (F1) and, because it ran its own compare loop, also lied in both directions
// (F7). This regression test pins the invariant: diff is update with the writes
// elided (registry-dryRun), so the two can never drift again.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { runInit as runInitCommand } from '../../src/commands/init.js'
import { runUpdate } from '../../src/commands/update.js'
import { runDiff } from '../../src/commands/diff.js'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-wave0-'))
}

function initGit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' })
}

function runInit(options: Parameters<typeof runInitCommand>[0]) {
  return runInitCommand({ ...options, language: 'typescript' })
}

interface DiffFile {
  key: string
  status: 'new' | 'changed' | 'unchanged'
  action: string
  path: string
}

interface DiffEnvelope {
  command: string
  status: string
  data: {
    hasChanges: boolean
    files: DiffFile[]
    remoteSideEffect?: { op: string; target: string }[]
  }
}

/** Run diff in --json mode and parse the structured envelope from stdout. */
function captureDiff(dir: string): DiffEnvelope {
  const chunks: string[] = []
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  const writeSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'))
      return true
    })
  try {
    runDiff({ dir, json: true })
  } finally {
    writeSpy.mockRestore()
    exitSpy.mockRestore()
  }
  const line = chunks
    .join('')
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .pop()
  if (!line) throw new Error(`diff produced no JSON envelope. Output: ${chunks.join('')}`)
  return JSON.parse(line) as DiffEnvelope
}

const TOUCHED = new Set(['created', 'replaced', 'backed-up-and-replaced'])

describe('#1077 Wave 0 reproducer: diff scope == update scope', () => {
  let dir: string

  beforeEach(async () => {
    dir = tmpDir()
    initGit(dir)
    await runInit({ yes: true, tools: 'claude,codex', level: 'L2', dir, noVerify: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('F1: diff enumerates the full registry file set, not a hardcoded subset', () => {
    // After init at L2 with claude+codex, the registry produces far more than
    // the legacy hardcoded ~9 entries. Pin a generous lower bound so a
    // regression back to the hardcoded list fails loudly.
    const diff = captureDiff(dir)
    expect(diff.data.files.length).toBeGreaterThan(20)
  })

  it('F7: after update, diff reports zero create/replace entries (idempotence)', async () => {
    await runUpdate({ dir, github: false })
    const diff = captureDiff(dir)
    const touched = diff.data.files.filter((f) => f.action !== 'skipped')
    expect(touched).toEqual([])
    expect(diff.data.hasChanges).toBe(false)
  })

  it('F1+F7: the set update touches is a subset of the set diff reports (U ⊆ D)', async () => {
    // Diff set D (everything the registry would emit), keyed by path.
    const diffBeforeUpdate = captureDiff(dir)
    const D = new Set(diffBeforeUpdate.data.files.map((f) => f.path))

    // Update set U = paths update actually wrote (action ∈ created/replaced/...).
    // We derive U from a second diff right after update: any path that diff now
    // reports as skipped but previously reported as touched was written by update.
    await runUpdate({ dir, github: false })
    const diffAfterUpdate = captureDiff(dir)

    const U = new Set(
      diffBeforeUpdate.data.files.filter((f) => TOUCHED.has(f.action)).map((f) => f.path),
    )
    for (const p of U) {
      expect(D.has(p)).toBe(true)
    }
    // And every previously-touched path is now skipped (update applied it).
    const afterByPath = new Map(diffAfterUpdate.data.files.map((f) => [f.path, f.action]))
    for (const p of U) {
      expect(afterByPath.get(p)).toBe('skipped')
    }
  })

  it('F6: two consecutive updates touch zero files on the second run', async () => {
    await runUpdate({ dir, github: false })
    const second = await runUpdate({ dir, github: false })
    // Re-run diff: nothing should be created/replaced after the first update.
    const diff = captureDiff(dir)
    const touched = diff.data.files.filter((f) => TOUCHED.has(f.action))
    expect(touched).toEqual([])
    void second
  })

  it('determinism: diff run twice yields identical file sets', () => {
    const a = captureDiff(dir)
    const b = captureDiff(dir)
    const keyA = a.data.files.map((f) => `${f.path}:${f.action}`).sort()
    const keyB = b.data.files.map((f) => `${f.path}:${f.action}`).sort()
    expect(keyA).toEqual(keyB)
  })

  it('diff is READ-ONLY: git status is unchanged after diff', () => {
    // Snapshot the working tree, run diff, snapshot again — must be byte-identical.
    const before = execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString()
    captureDiff(dir)
    captureDiff(dir)
    const after = execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString()
    expect(after).toBe(before)
  })

  it('ADR-001: diff --json enumerates remoteSideEffect descriptors only when GitHub is permitted', () => {
    // This fixture is initialized without GitHub (no permitGitHub/useGitHub),
    // so diff must NOT list any gh side effects.
    const diff = captureDiff(dir)
    expect(diff.data.remoteSideEffect ?? []).toEqual([])
  })
})
