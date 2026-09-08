// SPDX-License-Identifier: Apache-2.0
// #2548: packages/kernel/hooks/ is build-kernel-plugin.mjs's OUTPUT, but nothing ever
// compared the two — the generator threw ENOENT on every run until #2538, then landed
// this issue's own measurement: 475 insertions / 78 deletions across 6 files once it
// could finally run. scripts/check-kernel-plugin-parity.mjs closes that: it renders the
// generator into a throwaway temp dir and diffs it against a "committed" directory,
// never trusting the generator's own exit code or console output (prettier's own
// "(unchanged)" progress line during its --write pass is NOT a signal this check reads
// — see build-kernel-plugin.mjs).
//
// This suite exercises the script entirely through its `--dir <path>` override, against
// a PRIVATE snapshot copy of packages/kernel/hooks/ — never the live shared directory.
// vitest runs test FILES concurrently by default, and __tests__/scripts/build-kernel-plugin
// .test.ts already freely deletes/regenerates/restores that exact real directory as part
// of its own normal operation; asserting on the live path's real-time content here would
// race that file (observed directly: combining both files in one `vitest run` produced a
// spurious "packages/kernel/hooks/ is entirely missing" mid-mutation read). Testing
// against a snapshot copy exercises the identical code path (diffDirs, exit codes, file
// naming) with zero shared mutable state — the DEFAULT (no --dir) wiring into
// scripts/check-all.mjs is verified separately, statically, without executing it.
//
// CANON-24 inversion, proven three independent ways — each must flip the exit code to 1
// and NAME the offending file, then heal back to 0 once restored:
//   1. a committed hook hand-edited (content changed)
//   2. a committed hook deleted (generator still emits it)
//   3. an extra, ungenerated file present in the committed directory
// Plus: the check must never write into the directory it is comparing against (a parity
// gate that mutates the tree it is checking is not a check), and must be stable across
// two back-to-back runs on an unmodified tree (no spurious formatting-driven flakiness).
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  rmSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const repoRoot = resolve(__dirname, '..', '..')
const scriptPath = join(repoRoot, 'scripts', 'check-kernel-plugin-parity.mjs')
const COMMITTED_REL = 'packages/kernel/hooks'

let snapshotDir: string | undefined

afterEach(() => {
  if (snapshotDir) {
    rmSync(snapshotDir, { recursive: true, force: true })
    snapshotDir = undefined
  }
})

/**
 * A private, disposable copy of packages/kernel/hooks/ from the staged candidate — read from
 * git's object database via `git show`, never from the live working-tree path. vitest
 * runs test files concurrently by default, and __tests__/scripts/build-kernel-plugin
 * .test.ts freely deletes/regenerates/restores that exact real directory as part of its
 * own normal operation; a plain `cpSync` from the live path raced it directly (observed:
 * ENOENT mid-mutation). Freeze the index as an immutable tree: HEAD can still contain the
 * old generated hooks during pre-commit checks of a staged generator update or merge.
 */
function snapshot(): string {
  const tree = execFileSync('git', ['-C', repoRoot, 'write-tree'], { encoding: 'utf-8' }).trim()
  snapshotDir = mkdtempSync(join(tmpdir(), 'kernel-hooks-parity-snapshot-'))
  const names = execFileSync(
    'git',
    ['-C', repoRoot, 'ls-tree', '-r', '--name-only', tree, '--', COMMITTED_REL],
    { encoding: 'utf-8' },
  )
    .split('\n')
    .filter(Boolean)
  for (const path of names) {
    const content = execFileSync('git', ['-C', repoRoot, 'show', `${tree}:${path}`])
    const dest = join(snapshotDir, path.slice(COMMITTED_REL.length + 1))
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, content)
  }
  return snapshotDir
}

function run(dir: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [scriptPath, '--dir', dir], { cwd: repoRoot, encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('check-kernel-plugin-parity.mjs — wiring (static, no live execution)', () => {
  it('is wired into scripts/check-all.mjs at L1', () => {
    const gateSrc = readFileSync(join(repoRoot, 'scripts', 'check-all.mjs'), 'utf-8')
    const l1End = gateSrc.indexOf('// ─── gate: T1+T2 extended checks')
    expect(l1End).toBeGreaterThan(0)
    const l1Src = gateSrc.slice(0, l1End)
    expect(l1Src).toContain("'scripts/check-kernel-plugin-parity.mjs'")
  })

  it('the npm script points at the same file this suite tests', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'))
    expect(pkg.scripts['kernel-plugin:check']).toBe('node scripts/check-kernel-plugin-parity.mjs')
  })
})

describe('check-kernel-plugin-parity.mjs — behavior (against a private snapshot)', () => {
  it('exits 0 on an unmodified snapshot — read directly, not through a pipe', () => {
    const dir = snapshot()
    const result = run(dir)
    expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)
  })

  it('is stable across two consecutive runs on an unmodified snapshot (no spurious drift)', () => {
    const dir = snapshot()
    const first = run(dir)
    const second = run(dir)
    expect(first.status).toBe(0)
    expect(second.status).toBe(0)
  })

  it('never writes into the directory it compares against', () => {
    const dir = snapshot()
    const beforeFiles = readdirSync(dir).sort()
    const beforeContents = beforeFiles.map((f) => readFileSync(join(dir, f), 'utf-8'))
    run(dir)
    const afterFiles = readdirSync(dir).sort()
    const afterContents = afterFiles.map((f) => readFileSync(join(dir, f), 'utf-8'))
    expect(afterFiles).toEqual(beforeFiles)
    expect(afterContents).toEqual(beforeContents)
  })

  it('CANON-24 inversion #1 — a hand-edited hook flips the gate red, names the file, and heals back to green once restored', () => {
    const dir = snapshot()
    const target = join(dir, 'stop-dangerous.mjs')
    const original = readFileSync(target, 'utf-8')
    writeFileSync(target, '// #2548 test: hand-edited drift injected on purpose\n', 'utf-8')

    const drifted = run(dir)
    expect(drifted.status).toBe(1)
    expect(drifted.stdout + drifted.stderr).toContain('stop-dangerous.mjs')

    writeFileSync(target, original, 'utf-8')
    const healed = run(dir)
    expect(healed.status).toBe(0)
  })

  it('CANON-24 inversion #2 — a deleted hook the generator still emits flips the gate red and names the file', () => {
    const dir = snapshot()
    unlinkSync(join(dir, 'lib.mjs'))

    const drifted = run(dir)
    expect(drifted.status).toBe(1)
    expect(drifted.stdout + drifted.stderr).toContain('lib.mjs')
  })

  it('CANON-24 inversion #3 — an extra file the generator does not emit flips the gate red and names the file', () => {
    const dir = snapshot()
    writeFileSync(join(dir, 'not-a-real-hook.mjs'), '// should not be here\n', 'utf-8')

    const drifted = run(dir)
    expect(drifted.status).toBe(1)
    expect(drifted.stdout + drifted.stderr).toContain('not-a-real-hook.mjs')
  })

  it('fails (never a vacuous pass) when the committed directory is missing entirely', () => {
    const dir = snapshot()
    rmSync(dir, { recursive: true, force: true })

    // Missing entirely is drift (every generated file is "added"), not an infra error —
    // must still FAIL (1), never silently PASS by finding nothing to compare.
    const result = run(dir)
    expect(result.status).toBe(1)
  })
})
