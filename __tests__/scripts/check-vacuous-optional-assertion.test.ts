// SPDX-License-Identifier: Apache-2.0
// vacuous-optional-assertion guard (#2590): `expect(x ?? <default>).toEqual(<default>)` (or
// `.toBe(<default>)`) coerces an ABSENT key to the same value the assertion checks for, so
// deleting the key entirely still passes. This guard fails closed on that shape. NO-DATA (no
// test files) is a skip at exit 0; a populated dir with no vacuous shape passes. Fixture strings
// in this file need no `// arbiter-allow-vacuous` marker: the guard skips matches that sit inside
// a quoted string literal or a `//` comment, so these fixtures are inert as far as the guard's
// scan of ITS OWN source is concerned — they only become "code" once written into a temp fixture.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-vacuous-optional-assertion.mjs')

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, '--dir', dir, ...args], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'vacuous-optional-'))
  mkdirSync(join(dir, '__tests__'), { recursive: true })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-vacuous-optional-assertion (#2590)', () => {
  it('--help exits 0', () => {
    const r = spawnSync('node', [SCRIPT, '--help'], { encoding: 'utf-8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Usage')
  })

  it('no test files → SKIP (exit 0, NO-DATA)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('NO-DATA')
    } finally {
      cleanup()
    }
  })

  // Inversion proof (AC-4): the guard must REJECT this planted shape and ACCEPT its fix.
  it('inversion proof: nullish-default-toEqual shape → FAIL (exit 1); presence-first rewrite → PASS', () => {
    const { dir, cleanup } = makeRepo()
    try {
      const file = join(dir, '__tests__', 'a.test.ts')
      writeFileSync(file, 'expect(payload.data.wouldRestore ?? []).toEqual([])\n')
      const bad = run(dir)
      expect(bad.status).toBe(1)
      expect(bad.stderr).toContain('wouldRestore')

      writeFileSync(
        file,
        "expect(payload.data).toHaveProperty('wouldRestore')\n" +
          'expect(payload.data.wouldRestore).toEqual([])\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('object/array defaults are detected via toEqual, NOT via toBe (reference compare, always red)', () => {
    const vacuous = ['expect(x ?? []).toEqual([])\n', 'expect(x ?? {}).toEqual({})\n']
    for (const line of vacuous) {
      const { dir, cleanup } = makeRepo()
      try {
        writeFileSync(join(dir, '__tests__', 'a.test.ts'), line)
        expect(run(dir).status).toBe(1)
      } finally {
        cleanup()
      }
    }
    // `.toBe([])`/`.toBe({})` never pass for ANY x (a fresh literal is never reference-equal) —
    // that is a different, always-failing bug, not this guard's vacuous-on-removal shape.
    const notThisGuardsProblem = ['expect(x ?? []).toBe([])\n', 'expect(x ?? {}).toBe({})\n']
    for (const line of notThisGuardsProblem) {
      const { dir, cleanup } = makeRepo()
      try {
        writeFileSync(join(dir, '__tests__', 'a.test.ts'), line)
        expect(run(dir).status).toBe(0)
      } finally {
        cleanup()
      }
    }
  })

  it('primitive defaults are detected via toEqual AND toBe (value compare either way): \'\', "", null, false, 0', () => {
    const lines = [
      "expect(x ?? '').toBe('')\n",
      'expect(x ?? "").toBe("")\n',
      'expect(x ?? null).toBe(null)\n',
      'expect(x ?? false).toBe(false)\n',
      'expect(x ?? 0).toBe(0)\n',
      "expect(x ?? '').toEqual('')\n",
    ]
    for (const line of lines) {
      const { dir, cleanup } = makeRepo()
      try {
        writeFileSync(join(dir, '__tests__', 'a.test.ts'), line)
        expect(run(dir).status).toBe(1)
      } finally {
        cleanup()
      }
    }
  })

  it('one or more wrapping parens around the `??` expression are still detected', () => {
    const lines = ['expect((x ?? [])).toEqual([])\n', 'expect(((x ?? []))).toEqual([])\n']
    for (const line of lines) {
      const { dir, cleanup } = makeRepo()
      try {
        writeFileSync(join(dir, '__tests__', 'a.test.ts'), line)
        expect(run(dir).status).toBe(1)
      } finally {
        cleanup()
      }
    }
  })

  it('a real identifier/number is NOT mistaken for the null/false/0 literal (word-boundary)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(
        join(dir, '__tests__', 'a.test.ts'),
        'expect(nullable ?? 10).toBe(10)\nexpect(x ?? false).toBe(falsely)\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('the assertion wrapped across two lines is still detected', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, '__tests__', 'a.test.ts'), 'expect(x ?? [])\n  .toEqual([])\n')
      expect(run(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('a bare (non-expect) call with the same shape is NOT a violation (anchored to expect()/await expect())', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, '__tests__', 'a.test.ts'), 'checker(x ?? []).toEqual([])\n')
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('`await expect(...)` is still detected', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, '__tests__', 'a.test.ts'), 'await expect(x ?? []).toEqual([])\n')
      expect(run(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('default differs from the checked value → NOT a violation (absence already fails)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, '__tests__', 'a.test.ts'), "expect(x.file ?? '').toBe('src/z.ts')\n")
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('a `//` comment merely mentioning the shape is NOT a violation', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(
        join(dir, '__tests__', 'a.test.ts'),
        '// example of what NOT to write: expect(x ?? []).toEqual([])\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('a string literal merely containing the shape is NOT a violation', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(
        join(dir, '__tests__', 'a.test.ts'),
        'const bad = "expect(x ?? []).toEqual([])"\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('a trailing inline `//` comment after real code is stripped before matching', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(
        join(dir, '__tests__', 'a.test.ts'),
        "expect(x.file ?? '').toBe('src/z.ts') // NOT expect(x ?? []).toEqual([])\n",
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('a `/* ... */` block comment mentioning the shape is NOT a violation', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(
        join(dir, '__tests__', 'a.test.ts'),
        '/* bad: expect(x ?? []).toEqual([]) */\n' + "expect(x.file ?? '').toBe('src/z.ts')\n",
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('// arbiter-allow-vacuous: <reason> opts a real match out (exit 0)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(
        join(dir, '__tests__', 'a.test.ts'),
        '// arbiter-allow-vacuous: intentionally asserts empty-or-absent\n' +
          'expect(payload.data.x ?? []).toEqual([])\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('an unreadable test file (dangling symlink) FAILS closed and names the path', () => {
    // TESTING.md's "silent environment" trap: `chmod 000` binds nothing when the runner is root
    // (a real risk in CI/containers). A broken symlink fails to read regardless of uid — walkRepo
    // reports a symlink entry as a candidate FILE without following it (so it survives the
    // collector), and readFileSync then throws ENOENT on the dangling target.
    const { dir, cleanup } = makeRepo()
    try {
      const file = join(dir, '__tests__', 'a.test.ts')
      symlinkSync(join(dir, 'does-not-exist'), file)
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain(file)
    } finally {
      cleanup()
    }
  })

  it('an unreadable test file (EISDIR — a directory literally named *.test.ts) FAILS closed and names the path', () => {
    // TESTING.md:169's exact prescription: provoke EISDIR rather than rely on permission bits.
    // `walkRepo` only ever returns regular files/symlinks (a directory is recursed into, never
    // reported), so this also exercises the guard's own second collection pass for this shape.
    const { dir, cleanup } = makeRepo()
    try {
      const file = join(dir, '__tests__', 'foo.test.ts')
      mkdirSync(file)
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain(file)
    } finally {
      cleanup()
    }
  })
})
