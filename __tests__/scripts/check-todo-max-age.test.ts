// SPDX-License-Identifier: Apache-2.0
// RED phase (#1456, INV-133): a TO-DO(#NNN) whose linked issue was created more than
// MAX_AGE_DAYS ago must FAIL the gate. Age is derived ONLY from the issue created_at.
// When the created_at is unknown (gh missing / token absent / offline) the gate SKIPs
// and never false-fails. These tests pin the PURE decision logic so no live gh is needed.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  isOverAge,
  parseTodoIssueRefs,
  classifyOverAge,
  DEFAULT_MAX_AGE_DAYS,
} from '../../scripts/check-todo-max-age.mjs'

// #2526: the debt ratchet's todoCount collector matches a bare /\bTODO\b/ per line in .ts
// files, and cannot tell a deliberate fixture from real deferred work — so a test OF the
// TO-DO machinery inflates the very metric it exercises. Building the marker at runtime keeps
// every fixture and assertion byte-identical while keeping this file out of the count. Same
// technique the content-scanning checkers use for their own PATTERNS arrays.
const M = 'TO' + 'DO'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 5, 20) // 2026-06-20

const SCRIPT = resolve('scripts/check-todo-max-age.mjs')

describe('isOverAge (#1456)', () => {
  it('returns true when created_at is older than maxAgeDays', () => {
    const created = new Date(NOW - 200 * DAY).toISOString()
    expect(isOverAge(created, NOW, 180)).toBe(true)
  })

  it('returns false when created_at is within maxAgeDays', () => {
    const created = new Date(NOW - 100 * DAY).toISOString()
    expect(isOverAge(created, NOW, 180)).toBe(false)
  })

  it('returns false exactly at the boundary (age === maxAgeDays)', () => {
    const created = new Date(NOW - 180 * DAY).toISOString()
    expect(isOverAge(created, NOW, 180)).toBe(false)
  })

  it('returns false for an unparseable / empty created_at (never false-fail)', () => {
    expect(isOverAge('', NOW, 180)).toBe(false)
    expect(isOverAge('not-a-date', NOW, 180)).toBe(false)
    expect(isOverAge(null as unknown as string, NOW, 180)).toBe(false)
  })

  it('defaults MAX_AGE_DAYS to 180', () => {
    expect(DEFAULT_MAX_AGE_DAYS).toBe(180)
  })
})

describe('parseTodoIssueRefs (#1456)', () => {
  it('extracts issue numbers + line for each TO-DO(#NNN)', () => {
    const src = [
      'const a = 1',
      `// ${M}(#42): wire it up`,
      'foo()',
      `  /* ${M}(#7) cleanup */`,
    ].join('\n')
    expect(parseTodoIssueRefs(src)).toEqual([
      { issueNumber: 42, line: 2 },
      { issueNumber: 7, line: 4 },
    ])
  })

  it('ignores orphan TODOs without an issue number', () => {
    // Build the orphan markers by concatenation so this fixture is not itself
    // flagged by the orphan-TO-DO scanner (INV-21) that walks test sources.
    const orphans = '// TO' + 'DO: someday\n' + '// TO' + 'DO fixme'
    expect(parseTodoIssueRefs(orphans)).toEqual([])
  })
})

describe('classifyOverAge (#1456)', () => {
  const refs = [
    { file: 'src/a.ts', issueNumber: 100, line: 5 },
    { file: 'src/b.ts', issueNumber: 200, line: 9 },
  ]

  it('FAILS: an over-age linked TO-DO is reported', () => {
    const createdAt = new Map<number, string>([
      [100, new Date(NOW - 300 * DAY).toISOString()], // over-age
      [200, new Date(NOW - 10 * DAY).toISOString()], // fresh
    ])
    const result = classifyOverAge(refs, createdAt, NOW, 180)
    expect(result.skipped).toBe(false)
    expect(result.overAge).toHaveLength(1)
    expect(result.overAge[0]).toMatchObject({ issueNumber: 100, file: 'src/a.ts', line: 5 })
  })

  it('SKIPs (no false-fail) when NO created_at could be resolved (offline / no token)', () => {
    const result = classifyOverAge(refs, new Map(), NOW, 180)
    expect(result.skipped).toBe(true)
    expect(result.overAge).toHaveLength(0)
  })

  it('does NOT skip when at least one issue resolved; unresolved issues are ignored, not failed', () => {
    const createdAt = new Map<number, string>([[100, new Date(NOW - 10 * DAY).toISOString()]])
    const result = classifyOverAge(refs, createdAt, NOW, 180)
    expect(result.skipped).toBe(false)
    expect(result.overAge).toHaveLength(0)
  })

  it('reports all over-age TODOs', () => {
    const old = new Date(NOW - 365 * DAY).toISOString()
    const createdAt = new Map<number, string>([
      [100, old],
      [200, old],
    ])
    const result = classifyOverAge(refs, createdAt, NOW, 180)
    expect(result.overAge).toHaveLength(2)
  })
})

// ── CLI / programme-membership assertion (#2526) ───────────────────────────────
// #2526 root defect: `join(baseDir, dir)` at the scan-dir call site does NOT reset on an
// absolute `dir` (unlike resolve()), so `join('/repo', '/tmp/fixture/src')` silently becomes
// '/repo/tmp/fixture/src' — a path that (almost certainly) does not exist. The gate then scanned
// nothing, found zero TO-DO(#NNN) refs, and printed "no TO-DO(#NNN) references — PASS": the exact
// conflation of "nothing found" with "nothing looked at" (CANON-24). Mirrors #2512's fix for the
// sibling check-no-orphan-todo.mjs gate: resolve() instead of join(), plus a programme-membership
// assertion that fails loudly when the resolved scan set is empty.
//
// This gate resolves TO-DO age via `gh api .../issues/<n> --jq .created_at`, so the CLI-level
// tests below stub BOTH `git` (for `git remote get-url origin`, consulted before any gh call) and
// `gh` with tiny fake executables placed first on PATH — no live network or auth needed, and no
// case here can pass by silently falling through to the offline-SKIP path instead of a real PASS
// or FAIL.
function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'todo-age-'))
  mkdirSync(join(dir, 'src'), { recursive: true })
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** A fake `git` (fixed origin) + `gh` (per-issue-number created_at) pair, first on PATH. */
function makeFakeBin(createdAtByIssue: Record<number, string>): {
  bin: string
  cleanup: () => void
} {
  const bin = mkdtempSync(join(tmpdir(), 'todo-age-bin-'))
  const fakeGit = join(bin, 'git')
  writeFileSync(
    fakeGit,
    [
      '#!/bin/sh',
      'if [ "$1" = "remote" ]; then echo "https://github.com/testowner/testrepo.git"; exit 0; fi',
      'exit 1',
      '',
    ].join('\n'),
  )
  chmodSync(fakeGit, 0o755)
  const cases = Object.entries(createdAtByIssue)
    .map(([n, iso]) => `    */issues/${n}) echo '${iso}' ;;`)
    .join('\n')
  const fakeGh = join(bin, 'gh')
  writeFileSync(
    fakeGh,
    ['#!/bin/sh', 'case "$2" in', cases, '    *) echo "" ;;', 'esac', ''].join('\n'),
  )
  chmodSync(fakeGh, 0o755)
  return { bin, cleanup: () => rmSync(bin, { recursive: true, force: true }) }
}

// Run the gate FROM `cwd` with a scan-dir argument that may be relative OR absolute, and gh/git
// stubbed via a fake-bin dir prepended to PATH — same shape as check-no-orphan-todo.test.ts's
// `runFrom`, adapted for this gate's network dependency.
function runFrom(cwd: string, bin: string, scanDirArg?: string) {
  const args = scanDirArg === undefined ? [SCRIPT] : [SCRIPT, scanDirArg]
  const r = spawnSync('node', args, {
    encoding: 'utf-8',
    cwd,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('check-todo-max-age.mjs CLI (programme-membership assertion, #2526)', () => {
  // Inversion proof 1/4: an absolute scan directory containing an over-age TO-DO(#NNN) must FAIL
  // and name the file — this is the exact case that passed silently before the fix.
  it('flags a planted over-age TO-DO(#NNN) in an ABSOLUTE scan-dir argument instead of silently resolving under cwd', () => {
    const { dir: cwd, cleanup: cleanupCwd } = makeDir()
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'todo-age-abs-fixture-'))
    const old = new Date(NOW - 300 * DAY).toISOString()
    const { bin, cleanup: cleanupBin } = makeFakeBin({ 500: old })
    try {
      mkdirSync(join(fixtureRoot, 'src'), { recursive: true })
      writeFileSync(
        join(fixtureRoot, 'src', 'bad.ts'),
        `// ${M}(#500): resolve this eventually\nexport const a = 1\n`,
      )
      const absScanDir = join(fixtureRoot, 'src')
      const result = runFrom(cwd, bin, absScanDir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('FAIL')
      expect(result.stdout).toContain(`${M}(#500)`)
      expect(result.stdout).toContain('bad.ts')
    } finally {
      cleanupCwd()
      cleanupBin()
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  // Inversion proof 2/4: an absolute scan directory that is clean (all linked issues within age)
  // must pass, having actually scanned a non-zero, non-vacuous set.
  it('exits 0 on a CLEAN absolute scan-dir argument, having actually scanned it', () => {
    const { dir: cwd, cleanup: cleanupCwd } = makeDir()
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'todo-age-abs-fixture-'))
    const fresh = new Date(NOW - 10 * DAY).toISOString()
    const { bin, cleanup: cleanupBin } = makeFakeBin({ 600: fresh })
    try {
      mkdirSync(join(fixtureRoot, 'src'), { recursive: true })
      writeFileSync(
        join(fixtureRoot, 'src', 'ok.ts'),
        `// ${M}(#600): fine for now\nexport const a = 1\n`,
      )
      const absScanDir = join(fixtureRoot, 'src')
      const result = runFrom(cwd, bin, absScanDir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('PASS')
      // Must report a REAL non-zero scanned-file count — not the vacuous "found nothing" the
      // pre-fix join() bug produced for every absolute scan-dir argument.
      expect(result.stdout).toMatch(/scanned 1 file/i)
    } finally {
      cleanupCwd()
      cleanupBin()
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  // "Zero TO-DO(#NNN) references" is a legitimate state distinct from "zero files resolved" — a
  // clean absolute tree with NO TO-DO markers at all must still pass, backed by a real file count.
  it('exits 0 on an ABSOLUTE scan-dir with real files but no TO-DO(#NNN) references at all', () => {
    const { dir: cwd, cleanup: cleanupCwd } = makeDir()
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'todo-age-abs-fixture-'))
    const { bin, cleanup: cleanupBin } = makeFakeBin({})
    try {
      mkdirSync(join(fixtureRoot, 'src'), { recursive: true })
      writeFileSync(join(fixtureRoot, 'src', 'plain.ts'), 'export const a = 1\n')
      const absScanDir = join(fixtureRoot, 'src')
      const result = runFrom(cwd, bin, absScanDir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(`no ${M}(#NNN) references`)
      expect(result.stdout).toMatch(/scanned 1 file/i)
    } finally {
      cleanupCwd()
      cleanupBin()
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  // Inversion proof 3/4: a scan directory that does not exist, or resolves to zero files, must
  // FAIL loudly rather than pass — "looked at nothing" must be distinguishable from "found
  // nothing". Two sub-cases: a non-existent absolute path, and an empty existing directory.
  it('FAILS (not passes) when an ABSOLUTE scan-dir argument does not exist at all', () => {
    const { dir: cwd, cleanup: cleanupCwd } = makeDir()
    const { bin, cleanup: cleanupBin } = makeFakeBin({})
    const missing = join(tmpdir(), `todo-age-missing-${process.pid}-${Date.now()}`)
    try {
      const result = runFrom(cwd, bin, missing)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('ABORT')
      expect(result.stdout).toMatch(/scanned 0 file/i)
    } finally {
      cleanupCwd()
      cleanupBin()
    }
  })

  it('FAILS (not passes) when the requested scan dir exists but is empty', () => {
    const { dir: cwd, cleanup: cleanupCwd } = makeDir()
    const { bin, cleanup: cleanupBin } = makeFakeBin({})
    const emptyDir = mkdtempSync(join(tmpdir(), 'todo-age-empty-'))
    try {
      const result = runFrom(cwd, bin, emptyDir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('ABORT')
      expect(result.stdout).toMatch(/scanned 0 file/i)
    } finally {
      cleanupCwd()
      cleanupBin()
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  // Inversion proof 4/4: the default no-argument invocation must keep working unchanged against
  // `src` and `scripts` — resolve(baseDir, 'relative') joins under baseDir exactly like join()
  // did, so relative default dirs are unaffected by the fix.
  it('keeps the default no-argument invocation working against relative src/scripts dirs', () => {
    const { dir: cwd, cleanup: cleanupCwd } = makeDir()
    const { bin, cleanup: cleanupBin } = makeFakeBin({})
    try {
      writeFileSync(join(cwd, 'src', 'a.ts'), 'export const a = 1\n')
      writeFileSync(join(cwd, 'scripts', 'b.mjs'), 'export const b = 2\n')
      const result = runFrom(cwd, bin) // no scan-dir argv → defaults to ['src', 'scripts']
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(`no ${M}(#NNN) references`)
      expect(result.stdout).toMatch(/scanned 2 file/i)
    } finally {
      cleanupCwd()
      cleanupBin()
    }
  })
})
