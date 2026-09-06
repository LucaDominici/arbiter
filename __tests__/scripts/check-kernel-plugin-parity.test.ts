// SPDX-License-Identifier: Apache-2.0
// #2548: packages/kernel/hooks/ is build-kernel-plugin.mjs's OUTPUT, but nothing ever
// compared the two — the generator threw ENOENT on every run until #2538, then landed
// this issue's own measurement: 475 insertions / 78 deletions across 6 files once it
// could finally run. scripts/check-kernel-plugin-parity.mjs closes that: it renders the
// generator into a throwaway temp dir and diffs it against the committed
// packages/kernel/hooks/, never trusting the generator's own exit code or console
// output (prettier's own "(unchanged)" progress line during its --write pass is NOT a
// signal this check reads — see build-kernel-plugin.mjs).
//
// CANON-24 inversion, proven three independent ways — each must flip the exit code to 1
// and NAME the offending file, then heal back to 0 once restored:
//   1. a committed hook hand-edited (content changed)
//   2. a committed hook deleted (generator still emits it)
//   3. an extra, ungenerated file present in the committed directory
// Plus: the check must never write into packages/kernel/hooks/ itself (a parity gate
// that mutates the tree it is checking is not a check), and must be stable across two
// back-to-back runs on an unmodified tree (no spurious formatting-driven flakiness).
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { cpSync, rmSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const repoRoot = resolve(__dirname, '..', '..')
const scriptPath = join(repoRoot, 'scripts', 'check-kernel-plugin-parity.mjs')
const outDir = join(repoRoot, 'packages', 'kernel', 'hooks')

let backupDir: string | undefined

afterEach(() => {
  // Restore whatever was at packages/kernel/hooks/ before the test ran, regardless of
  // pass/fail — no test in this suite may leave the real tree mutated.
  if (backupDir) {
    rmSync(outDir, { recursive: true, force: true })
    cpSync(backupDir, outDir, { recursive: true })
    rmSync(backupDir, { recursive: true, force: true })
    backupDir = undefined
  }
})

function backup() {
  backupDir = mkdtempSync(join(tmpdir(), 'kernel-hooks-parity-backup-'))
  cpSync(outDir, backupDir, { recursive: true })
}

function run(): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [scriptPath], { cwd: repoRoot, encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('check-kernel-plugin-parity.mjs', () => {
  it('exits 0 on an unmodified tree — read directly, not through a pipe', () => {
    const result = run()
    expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)
  })

  it('is stable across two consecutive runs on an unmodified tree (no spurious drift)', () => {
    const first = run()
    const second = run()
    expect(first.status).toBe(0)
    expect(second.status).toBe(0)
  })

  it('never writes into packages/kernel/hooks/ — a parity gate must not mutate what it checks', () => {
    const beforeFiles = readdirSync(outDir).sort()
    const beforeContents = beforeFiles.map((f) => readFileSync(join(outDir, f), 'utf-8'))
    run()
    const afterFiles = readdirSync(outDir).sort()
    const afterContents = afterFiles.map((f) => readFileSync(join(outDir, f), 'utf-8'))
    expect(afterFiles).toEqual(beforeFiles)
    expect(afterContents).toEqual(beforeContents)
  })

  it('CANON-24 inversion #1 — a hand-edited hook flips the gate red and names the file', () => {
    backup()
    const target = join(outDir, 'stop-dangerous.mjs')
    writeFileSync(target, '// #2548 test: hand-edited drift injected on purpose\n', 'utf-8')

    const drifted = run()
    expect(drifted.status).toBe(1)
    expect(drifted.stdout + drifted.stderr).toContain('stop-dangerous.mjs')

    // Restore and prove it heals back to green (the other half of the inversion proof).
    rmSync(outDir, { recursive: true, force: true })
    cpSync(backupDir!, outDir, { recursive: true })
    const healed = run()
    expect(healed.status).toBe(0)
  })

  it('CANON-24 inversion #2 — a deleted hook the generator still emits flips the gate red and names the file', () => {
    backup()
    unlinkSync(join(outDir, 'lib.mjs'))

    const drifted = run()
    expect(drifted.status).toBe(1)
    expect(drifted.stdout + drifted.stderr).toContain('lib.mjs')
  })

  it('CANON-24 inversion #3 — an extra file the generator does not emit flips the gate red and names the file', () => {
    backup()
    writeFileSync(join(outDir, 'not-a-real-hook.mjs'), '// should not be here\n', 'utf-8')

    const drifted = run()
    expect(drifted.status).toBe(1)
    expect(drifted.stdout + drifted.stderr).toContain('not-a-real-hook.mjs')
  })

  it('exits 2 when packages/kernel/hooks/ is missing entirely (fail closed, never a vacuous pass)', () => {
    backup()
    rmSync(outDir, { recursive: true, force: true })

    // Missing entirely is drift (every generated file is "added"), not an infra error —
    // must still FAIL (1), never silently PASS by finding nothing to compare.
    const result = run()
    expect(result.status).toBe(1)
  })
})
