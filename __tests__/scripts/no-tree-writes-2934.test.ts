// SPDX-License-Identifier: Apache-2.0
// Regression for #2934: no test under __tests__/ may create files in tracked repository
// directories. `wiki-migrate-1244.test.ts` planted `docs/METHOD/KNOWLEDGE_MAP.md` (a real,
// non-gitignored path) in beforeAll/afterAll — a transient race window that
// `doc-gate-allowlist-2917.test.ts` (which spawns check-doc-style.mjs over the same tree) can
// observe when the two overlap in the fork pool.
//
// AC-1: wiki-migrate-1244.test.ts uses a tmp root for the residue case, not the repo tree.
// AC-2: a guard test fails if ANY __tests__/**/*.test.ts file writes into the repo tree instead
//   of a tmp root. Implemented here as a static scan (cheap, deterministic, no full-suite run
//   needed to catch the class of bug): a file that (a) defines the `ROOT = resolve(__dirname,
//   ..., '..')` / `r = (p) => join(ROOT, p)` repo-root helper this codebase's tests conventionally
//   use, AND (b) calls a tree-mutating fs function through that helper, AND (c) never uses
//   mkdtempSync/tmpdir() anywhere in the file, is an offender.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..', '..')

const MUTATORS = [
  'writeFileSync',
  'mkdirSync',
  'appendFileSync',
  'copyFileSync',
  'cpSync',
  'renameSync',
]

function testFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--', '__tests__'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  return out.split('\0').filter((f) => f.endsWith('.test.ts'))
}

/** Files that define the repo-root `ROOT`/`r()` helper, mutate the tree through it, and never
 *  fall back to a tmp root anywhere in the file. */
function offenders(): string[] {
  const usesTmp = /mkdtempSync|tmpdir\(\)/
  const definesRepoRootHelper = /const\s+ROOT\s*=\s*resolve\(__dirname/
  const mutatorCallOnHelper = new RegExp(`\\b(${MUTATORS.join('|')})\\(\\s*(r\\(|[A-Z_]*ROOT\\b)`)

  return testFiles().filter((f) => {
    const src = readFileSync(join(ROOT, f), 'utf-8')
    return definesRepoRootHelper.test(src) && mutatorCallOnHelper.test(src) && !usesTmp.test(src)
  })
}

describe('#2934 — no test writes into tracked repo directories', () => {
  it('no __tests__/**/*.test.ts file mutates the tree via its ROOT/r() helper without a tmp root', () => {
    expect(offenders()).toEqual([])
  })
})
