// SPDX-License-Identifier: Apache-2.0
// Guard #1 (muted-test, #1412): a GATE test silenced by a skip/disable marker is a falso-green —
// the suite goes green because the test that would catch the regression never runs. This guard
// greps gate test dirs for cross-stack skip markers and FAILS closed. NO-DATA (no test dir) is a
// skip at exit 0, never a manufactured pass; a populated dir with NO markers passes.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-muted-test.mjs')

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd: dir })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'muted-test-'))
  mkdirSync(join(dir, '__tests__'), { recursive: true })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-muted-test (guard #1, #1412)', () => {
  it('--help exits 0', () => {
    const { dir, cleanup } = makeRepo()
    try {
      const r = run(dir, ['--help'])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Usage')
    } finally {
      cleanup()
    }
  })

  it('clean populated test dir → PASS (exit 0)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(
        join(dir, '__tests__', 'a.test.ts'),
        "it('works', () => { expect(1).toBe(1) })\n",
      )
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('it.skip in a gate test → FAIL (exit 1)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, '__tests__', 'a.test.ts'), "it.skip('muted', () => {})\n")
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr + r.stdout).toMatch(/skip|mut/i)
    } finally {
      cleanup()
    }
  })

  it('describe.skip + xit + test.skip are all detected', () => {
    for (const marker of ['describe.skip(', 'xit(', 'test.skip(']) {
      const { dir, cleanup } = makeRepo()
      try {
        writeFileSync(join(dir, '__tests__', 'a.test.ts'), `${marker}'m', () => {})\n`)
        expect(run(dir).status).toBe(1)
      } finally {
        cleanup()
      }
    }
  })

  it('Java @Disabled in a gate test → FAIL (exit 1)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      mkdirSync(join(dir, 'src', 'test', 'java'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'test', 'java', 'FooTest.java'),
        '@Disabled\n@Test\nvoid foo() {}\n',
      )
      const r = run(dir)
      expect(r.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('string literals that merely mention a marker → NOT a violation (no false-green of the guard)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(
        join(dir, '__tests__', 'a.test.ts'),
        "it('detects it.skip(', () => {\n" +
          "  expect(out).not.toContain('it.skip(')\n" +
          "  const markers = ['@Disabled', 'xit(', 'describe.skip(']\n" +
          '})\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('// muted-test-exempt: <rationale> opts a marker out (exit 0)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(
        join(dir, '__tests__', 'a.test.ts'),
        '// muted-test-exempt: flaky upstream, tracked in #9999\nit.skip("later", () => {})\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('// arbiter-allow-skip: <reason> opts an audited marker out (exit 0)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(
        join(dir, '__tests__', 'a.test.ts'),
        '// arbiter-allow-skip: flaky upstream, tracked in #9999\nit.skip("later", () => {})\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('arbiter-allow-skip with no reason still FAILS (audited marker needs a rationale)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(
        join(dir, '__tests__', 'a.test.ts'),
        '// arbiter-allow-skip:\nit.skip("later", () => {})\n',
      )
      expect(run(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('marker token buried in a string literal does NOT exempt (anti-fake-green)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(
        join(dir, '__tests__', 'a.test.ts'),
        "const x = 'arbiter-allow-skip: lie'\nit.skip('x', () => {})\n",
      )
      expect(run(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('a trailing-comment arbiter-allow-skip on the skip line exempts (exit 0)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(
        join(dir, '__tests__', 'a.test.ts'),
        'it.skip("later", () => {}) // arbiter-allow-skip: env-gated, runs in extended gate\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('an UNMARKED skip on a gate test still FAILS (behavior unchanged)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      writeFileSync(join(dir, '__tests__', 'a.test.ts'), 'it.skip("later", () => {})\n')
      expect(run(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('JVM assume-style abort (Assumptions.assumeTrue) on a gate test → FAIL (exit 1)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      mkdirSync(join(dir, 'src', 'test', 'java'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'test', 'java', 'FooTest.java'),
        '@Test\nvoid foo() {\nAssumptions.assumeTrue(false);\n}\n',
      )
      expect(run(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('JVM bare assumeFalse / abort aborts are detected', () => {
    for (const marker of ['assumeFalse(env);', 'abort("skip");', 'Assumptions.abort();']) {
      const { dir, cleanup } = makeRepo()
      try {
        mkdirSync(join(dir, 'src', 'test', 'kotlin'), { recursive: true })
        writeFileSync(
          join(dir, 'src', 'test', 'kotlin', 'BarTest.kt'),
          `@Test\nfun bar() {\n${marker}\n}\n`,
        )
        expect(run(dir).status).toBe(1)
      } finally {
        cleanup()
      }
    }
  })

  it('an audited assume-abort with arbiter-allow-skip opts out (exit 0)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      mkdirSync(join(dir, 'src', 'test', 'java'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'test', 'java', 'FooTest.java'),
        '@Test\nvoid foo() {\n// arbiter-allow-skip: env-gated integration, runs only in extended gate\nAssumptions.assumeTrue(hasDocker());\n}\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('NO-DATA (no test dirs at all) → SKIP at exit 0, never a manufactured pass', () => {
    const dir = mkdtempSync(join(tmpdir(), 'muted-test-empty-'))
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/SKIP|NO-DATA/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an existing test dir with no test files → SKIP at exit 0 (NO-DATA, not a pass)', () => {
    const { dir, cleanup } = makeRepo()
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/SKIP|NO-DATA/i)
    } finally {
      cleanup()
    }
  })
})
