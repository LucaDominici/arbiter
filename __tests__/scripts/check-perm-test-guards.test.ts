// SPDX-License-Identifier: Apache-2.0
// #2420 AC-3: scripts/check-perm-test-guards.mjs is wired as a hard L1 gate with zero
// tests — its scan root was hardcoded to <repo>/__tests__, so no fixture could reach it.
// These tests exercise the INV-53 exit contract (0=clean / 1=violation / 2=cannot run)
// against controlled fixtures via the `--dir` override shared by the scan-family gates.
//
// The fixture bodies are assembled from fragments ('chmod' + 'Sync(...)') on purpose: a
// literal chmod-to-unreadable call in this file would itself be scanned by the gate under
// test when it runs over arbiter's own __tests__ tree.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const SCRIPT = resolve('scripts/check-perm-test-guards.mjs')
const CHMOD_CALL = 'chmod' + 'Sync(target, 0o000)'
const ROOT_GUARD = 'if (process.getuid?.() === 0) return'

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function withFixtureDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'perm-guards-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('check-perm-test-guards.mjs — A (clean)', () => {
  it('exits 0 when a chmod-to-unreadable site carries a root guard', () => {
    withFixtureDir((dir) => {
      writeFileSync(
        join(dir, 'guarded.test.ts'),
        ['it("denies read", () => {', `  ${ROOT_GUARD}`, `  ${CHMOD_CALL}`, '})', ''].join('\n'),
      )
      const r = run(['--dir', dir])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('OK')
    })
  })

  it('exits 0 for a fixture dir with no permission tests at all', () => {
    withFixtureDir((dir) => {
      writeFileSync(join(dir, 'plain.test.ts'), 'it("adds", () => { expect(1 + 1).toBe(2) })\n')
      expect(run(['--dir', dir]).status).toBe(0)
    })
  })

  it('ignores non-test files even when they hold an unguarded chmod site', () => {
    withFixtureDir((dir) => {
      writeFileSync(join(dir, 'helper.ts'), `export function lock() {\n  ${CHMOD_CALL}\n}\n`)
      expect(run(['--dir', dir]).status).toBe(0)
    })
  })

  it('accepts a guard exactly at the 6-line window boundary', () => {
    withFixtureDir((dir) => {
      const filler = Array.from({ length: 5 }, (_, i) => `  const pad${i} = ${i}`)
      writeFileSync(
        join(dir, 'boundary.test.ts'),
        ['it("boundary", () => {', `  ${ROOT_GUARD}`, ...filler, `  ${CHMOD_CALL}`, '})', ''].join(
          '\n',
        ),
      )
      expect(run(['--dir', dir]).status).toBe(0)
    })
  })
})

describe('check-perm-test-guards.mjs — B (drift)', () => {
  it('exits 1 and names file:line when the root guard is missing', () => {
    withFixtureDir((dir) => {
      writeFileSync(
        join(dir, 'unguarded.test.ts'),
        ['it("denies read", () => {', `  ${CHMOD_CALL}`, '})', ''].join('\n'),
      )
      const r = run(['--dir', dir])
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('FAIL')
      expect(r.stderr).toContain('unguarded.test.ts:2')
      expect(r.stderr).toContain('process.getuid')
    })
  })

  it('exits 1 when the guard sits outside the 6-line window', () => {
    withFixtureDir((dir) => {
      const filler = Array.from({ length: 6 }, (_, i) => `  const pad${i} = ${i}`)
      writeFileSync(
        join(dir, 'too-far.test.ts'),
        ['it("too far", () => {', `  ${ROOT_GUARD}`, ...filler, `  ${CHMOD_CALL}`, '})', ''].join(
          '\n',
        ),
      )
      expect(run(['--dir', dir]).status).toBe(1)
    })
  })

  it('reports every unguarded site, not just the first', () => {
    withFixtureDir((dir) => {
      writeFileSync(join(dir, 'a.test.ts'), `it("a", () => {\n  ${CHMOD_CALL}\n})\n`)
      writeFileSync(join(dir, 'b.test.ts'), `it("b", () => {\n  ${CHMOD_CALL}\n})\n`)
      const r = run(['--dir', dir])
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('a.test.ts:2')
      expect(r.stderr).toContain('b.test.ts:2')
    })
  })
})

describe('check-perm-test-guards.mjs — C (error)', () => {
  it('exits 2 when the --dir target does not exist (INV-53: cannot run)', () => {
    withFixtureDir((dir) => {
      const r = run(['--dir', join(dir, 'no-such-subdir')])
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('no-such-subdir')
    })
  })

  it('exits 2 when --dir is supplied without a value', () => {
    const r = run(['--dir'])
    expect(r.status).toBe(2)
  })
})
