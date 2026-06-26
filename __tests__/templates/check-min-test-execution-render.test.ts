// SPDX-License-Identifier: Apache-2.0
// Render + behaviour test (INV-48 / CANON-04) for scripts/check-min-test-execution.mjs.ejs — the
// no-empty-suite / min-execution guard shipped into generated projects (A2, #1497). Proves the
// consumer template renders to a self-contained, EJS-tag-free guard, that its per-runner count
// parsers read real captured collect output correctly (vitest/jest/pytest/go), and that the guard
// fires RED on an empty suite and GREEN on a real one end-to-end against vitest.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function render(): string {
  const data = makeConfig('/tmp/test', {
    language: 'typescript',
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>
  return renderTemplate('scripts/check-min-test-execution.mjs.ejs', data)
}

/** Write the rendered guard into <dir>/scripts and return its absolute path. */
function plantGuard(dir: string): string {
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  const p = join(dir, 'scripts', 'check-min-test-execution.mjs')
  writeFileSync(p, render())
  return p
}

/** Feed `input` to the guard's `--parse <runner>` stdin seam; return the parsed count string. */
function parse(guard: string, runner: string, input: string): string {
  const r = spawnSync('node', [guard, '--parse', runner], { input, encoding: 'utf-8' })
  expect(r.status).toBe(0)
  return (r.stdout ?? '').trim()
}

describe('scripts/check-min-test-execution.mjs.ejs (A2, #1497)', () => {
  it('renders a self-contained guard with no EJS-tag leak', () => {
    const content = render()
    expect(content).toMatch(/^#!/)
    expect(content).toContain('--help')
    expect(content).toContain('INV-25')
    expect(content).toContain('min-test-execution')
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
    // No lib import — must run in a project that has no arbiter install.
    expect(content).not.toContain("from './lib/")
  })

  it('does not early-return NA on a runner-less package.json — falls through to go.mod (polyglot)', () => {
    const content = render()
    // Regression (gate-reality audit): a JS-frontend + Go-backend repo has a root package.json
    // with no vitest/jest. The guard must NOT short-circuit to NA before reaching the go.mod
    // branch, or the empty-suite false-green goes unchecked for the backend suite.
    expect(content).not.toContain('return null // node project')
    expect(content).toMatch(/fall through to the go\.mod/i)
  })

  it('parses real captured collect output across vitest/jest/pytest/go (empty ⇒ 0, real ⇒ N)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mte-parse-'))
    try {
      const guard = plantGuard(dir)

      // vitest list — one " > " test-id per line.
      expect(
        parse(
          guard,
          'vitest',
          'src/a.test.ts > suite > does a thing\nsrc/a.test.ts > suite > does another\n',
        ),
      ).toBe('2')
      expect(parse(guard, 'vitest', '')).toBe('0')

      // jest --listTests — one absolute test-FILE path per line.
      expect(parse(guard, 'jest', '/p/a.test.ts\n/p/b.test.ts\n')).toBe('2')
      expect(parse(guard, 'jest', '')).toBe('0')

      // pytest --collect-only -q — "<N> tests collected" / "no tests collected" / "collected N items".
      expect(
        parse(
          guard,
          'pytest',
          'test_x.py::test_a\ntest_x.py::test_b\n\n2 tests collected in 0.00s\n',
        ),
      ).toBe('2')
      expect(parse(guard, 'pytest', '\nno tests collected in 0.00s\n')).toBe('0')
      expect(parse(guard, 'pytest', 'collected 5 items\n')).toBe('5')

      // go test -list '.*' ./... — one Test/Example/Benchmark/Fuzz name per line; status lines ignored.
      expect(parse(guard, 'go', 'TestA\nTestB\nok  \tex\t0.001s\n')).toBe('2')
      expect(parse(guard, 'go', '?   \tex\t[no test files]\n')).toBe('0')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('NA-passes when no recognized test runner is present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mte-na-'))
    try {
      const guard = plantGuard(dir)
      const r = spawnSync('node', [guard], { cwd: dir, encoding: 'utf-8' })
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/NA/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('end-to-end: FAILS red on an empty vitest suite, PASSES green when a real test is added', () => {
    const repoNodeModules = resolve('node_modules')
    const vitestBin = join(repoNodeModules, '.bin', 'vitest')
    if (!existsSync(vitestBin)) return // vitest not installed in this env — covered by --parse tests
    const dir = mkdtempSync(join(tmpdir(), 'mte-e2e-'))
    try {
      const guard = plantGuard(dir)
      symlinkSync(repoNodeModules, join(dir, 'node_modules'))
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify(
          { name: 'mte-e2e', type: 'module', devDependencies: { vitest: '*' } },
          null,
          2,
        ),
      )
      writeFileSync(
        join(dir, 'vitest.config.ts'),
        "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ test: { include: ['**/*.test.ts'] } })\n",
      )
      mkdirSync(join(dir, 'src'), { recursive: true })
      const run = () =>
        spawnSync('node', [guard], { cwd: dir, encoding: 'utf-8', timeout: 120_000 })

      // RED — empty suite: `vitest list` collects 0 tests yet a `--passWithNoTests` gate would be green.
      const red = run()
      expect(red.status).toBe(1)
      expect(`${red.stderr}`).toMatch(/collected 0 tests/)

      // GREEN — a real test present: `vitest list` collects > 0.
      writeFileSync(
        join(dir, 'src', 'real.test.ts'),
        "import { it, expect } from 'vitest'\nit('runs', () => { expect(1).toBe(1) })\n",
      )
      const green = run()
      expect(green.status).toBe(0)
      expect(`${green.stdout}`).toMatch(/collects 1 test/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
