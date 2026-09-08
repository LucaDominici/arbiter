// SPDX-License-Identifier: Apache-2.0
// #2538: build-kernel-plugin.mjs threw ENOENT on every run because its
// COPIED list named two hooks (check-no-orphan-todo.mjs, check-no-placeholders.mjs)
// at their pre-.ejs paths — both are now EJS-templated. A test that only
// asserted on the *file list* the script claims to produce would have passed
// while the script itself threw, so this suite makes the exit code (and a
// from-scratch run) part of the assertion, plus an unrendered-EJS-delimiter
// scan that would also catch the wrong fix (copying the .ejs source verbatim).
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  symlinkSync,
  rmSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const repoRoot = resolve(__dirname, '..', '..')
const scriptPath = join(repoRoot, 'scripts', 'build-kernel-plugin.mjs')
const sourceOutDir = join(repoRoot, 'packages', 'kernel', 'hooks')
let outDir: string

// Every file the script claims (in its own RENDERED/COPIED/hooks.json output)
// to produce under packages/kernel/hooks/. Hardcoded deliberately: this is the
// contract the generator makes with consumers of the kernel plugin, not an
// echo of whatever the script happens to loop over today.
const EXPECTED_OUTPUT_FILES = [
  'lib.mjs',
  'stop-evidence-guard.mjs',
  'guard-done-evidence.mjs',
  'stop-dangerous.mjs',
  'enforce-read-only.mjs',
  'enforce-gate-before-pr.mjs',
  'pre-edit-ssot-guard.mjs',
  'check-no-orphan-todo.mjs',
  'check-no-placeholders.mjs',
  'hooks.json',
]

let fixtureRoot: string | undefined

afterEach(() => {
  if (fixtureRoot) {
    rmSync(fixtureRoot, { recursive: true, force: true })
    fixtureRoot = undefined
  }
})

function runFromCleanState(): { status: number; stdout: string; stderr: string } {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'kernel-hooks-build-'))
  mkdirSync(join(fixtureRoot, 'scripts'))
  mkdirSync(join(fixtureRoot, 'src'))
  const fixtureScript = join(fixtureRoot, 'scripts', 'build-kernel-plugin.mjs')
  copyFileSync(scriptPath, fixtureScript)
  for (const name of ['package.json', '.prettierrc.json', '.prettierignore']) {
    copyFileSync(join(repoRoot, name), join(fixtureRoot, name))
  }
  for (const name of ['dist', 'node_modules', 'src/templates']) {
    symlinkSync(join(repoRoot, name), join(fixtureRoot, name), 'dir')
  }
  // Only the owned temporary output starts absent; never mutate shared hooks.
  outDir = join(fixtureRoot, 'packages', 'kernel', 'hooks')
  const result = spawnSync('node', [fixtureScript], { cwd: fixtureRoot, encoding: 'utf-8' })
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

describe('build-kernel-plugin.mjs', () => {
  it('exits 0 from a clean state and produces every hook it claims to', () => {
    const before = EXPECTED_OUTPUT_FILES.map((name) =>
      readFileSync(join(sourceOutDir, name), 'utf-8'),
    )
    const result = runFromCleanState()

    expect(
      EXPECTED_OUTPUT_FILES.map((name) =>
        readFileSync(join(repoRoot, 'packages', 'kernel', 'hooks', name), 'utf-8'),
      ),
    ).toEqual(before)

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)

    for (const name of EXPECTED_OUTPUT_FILES) {
      expect(existsSync(join(outDir, name)), `missing output: ${name}`).toBe(true)
    }

    // No stray files beyond what's claimed (catches a silently-dropped or
    // silently-added entry in RENDERED/COPIED).
    const actual = readdirSync(outDir).sort()
    expect(actual).toEqual([...EXPECTED_OUTPUT_FILES].sort())
  })

  it('emits no kernel hook containing unrendered EJS delimiters', () => {
    runFromCleanState()

    for (const name of EXPECTED_OUTPUT_FILES) {
      if (!name.endsWith('.mjs')) continue
      const body = readFileSync(join(outDir, name), 'utf-8')
      expect(body.includes('<%'), `${name} contains an unrendered EJS open tag`).toBe(false)
      expect(body.includes('%>'), `${name} contains an unrendered EJS close tag`).toBe(false)
    }
  })

  // #2538 fixed only these two: they were the ones the broken COPIED list threw
  // on, and their content is now verified in sync with the generator. The other
  // seven packages/kernel/hooks/ files were found to ALSO have drifted from the
  // generator (the generator has been unable to run at all, so nothing under
  // packages/kernel/hooks/ could be regenerated) — a materially larger, separate
  // body of work spanning many issues (#565, #1441, #1872, #1990, #2022, #2399,
  // #2403), captured via `arbiter note` rather than folded into this fix.
  const FILES_FIXED_BY_2538 = ['check-no-orphan-todo.mjs', 'check-no-placeholders.mjs']

  it('regenerates the #2538-fixed hooks byte-identical to what is now committed', () => {
    // Expected bytes come from committed history, never from generated output.
    const before = new Map<string, string>()
    for (const name of FILES_FIXED_BY_2538) {
      const committed = spawnSync('git', ['show', `HEAD:packages/kernel/hooks/${name}`], {
        cwd: repoRoot,
        encoding: 'utf-8',
      })
      expect(committed.status).toBe(0)
      before.set(name, committed.stdout)
    }

    const result = runFromCleanState()
    expect(result.status).toBe(0)

    for (const name of FILES_FIXED_BY_2538) {
      const after = readFileSync(join(outDir, name), 'utf-8')
      expect(after, `${name} differs from the committed copy — drift`).toBe(before.get(name))
    }
  })
})
