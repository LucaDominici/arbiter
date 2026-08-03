import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-template-tests.mjs')

function run(
  templatesDir: string,
  testsDir: string,
  baselineFile: string,
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(
    'node',
    [SCRIPT, `--templates=${templatesDir}`, `--tests=${testsDir}`, `--baseline=${baselineFile}`],
    { encoding: 'utf-8', cwd: resolve('.') },
  )
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'canon04-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-template-tests.mjs (INV-48 / CANON-04)', () => {
  it('exits 0 when all EJS files appear in test files', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const tmplDir = join(dir, 'templates')
      const testDir = join(dir, 'tests')
      const baseline = join(dir, 'baseline.txt')
      mkdirSync(tmplDir)
      mkdirSync(testDir)
      writeFileSync(join(tmplDir, 'foo.mjs.ejs'), '<%= name %>')
      writeFileSync(join(testDir, 'foo.test.ts'), 'renderTemplate("foo.mjs.ejs", data)')
      writeFileSync(baseline, '0')
      expect(run(tmplDir, testDir, baseline).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when untested count equals baseline (no regression)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const tmplDir = join(dir, 'templates')
      const testDir = join(dir, 'tests')
      const baseline = join(dir, 'baseline.txt')
      mkdirSync(tmplDir)
      mkdirSync(testDir)
      writeFileSync(join(tmplDir, 'a.ejs'), '')
      writeFileSync(join(tmplDir, 'b.ejs'), '')
      // Only 'a' has a test — 1 missing, matches baseline
      writeFileSync(join(testDir, 'a.test.ts'), 'renderTemplate("a.ejs")')
      writeFileSync(baseline, '1')
      expect(run(tmplDir, testDir, baseline).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when untested count exceeds baseline (regression)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const tmplDir = join(dir, 'templates')
      const testDir = join(dir, 'tests')
      const baseline = join(dir, 'baseline.txt')
      mkdirSync(tmplDir)
      mkdirSync(testDir)
      writeFileSync(join(tmplDir, 'a.ejs'), '')
      writeFileSync(join(tmplDir, 'b.ejs'), '')
      writeFileSync(join(tmplDir, 'c.ejs'), '')
      // Only 'a' has a test — 2 missing, baseline was 1
      writeFileSync(join(testDir, 'a.test.ts'), 'renderTemplate("a.ejs")')
      writeFileSync(baseline, '1')
      const result = run(tmplDir, testDir, baseline)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('regression')
    } finally {
      cleanup()
    }
  })

  // #2013 supersedes the previous expectation here. An improvement below the baseline
  // used to pass silently, leaving the recovered slots free to be re-filled later — the
  // slack that made the ratchet dishonest. It now fails until the win is banked.
  it('exits 1 when untested count is below baseline (improvement must be banked)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const tmplDir = join(dir, 'templates')
      const testDir = join(dir, 'tests')
      const baseline = join(dir, 'baseline.txt')
      mkdirSync(tmplDir)
      mkdirSync(testDir)
      writeFileSync(join(tmplDir, 'a.ejs'), '')
      writeFileSync(join(testDir, 'a.test.ts'), 'renderTemplate("a.ejs")')
      // All tested — 0 missing vs baseline of 5
      writeFileSync(baseline, '5')
      const r = run(tmplDir, testDir, baseline)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('unbanked improvement')
      // …and banking it makes the very same tree pass.
      const banked = spawnSync(
        'node',
        [
          SCRIPT,
          `--templates=${tmplDir}`,
          `--tests=${testDir}`,
          `--baseline=${baseline}`,
          '--update-baseline',
        ],
        { encoding: 'utf-8', cwd: resolve('.') },
      )
      expect(banked.status).toBe(0)
      expect(run(tmplDir, testDir, baseline).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('passes against the real templates, tests, and baseline', () => {
    const result = run(
      resolve('src/templates'),
      resolve('__tests__/templates'),
      resolve('.template-tests-baseline.txt'),
    )
    expect(result.status).toBe(0)
  })
})

// #2013: same honesty fix as the brownfield ratchet — report the denominator, and make
// banking an improvement mandatory so recovered slots cannot be silently re-filled.
describe('check-template-tests.mjs — honest ratchet (#2013)', () => {
  it('reports the untested count with its denominator and percentage', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const tplDir = join(dir, 'templates')
      const testDir = join(dir, 'tests')
      const baseline = join(dir, 'baseline.txt')
      mkdirSync(tplDir)
      mkdirSync(testDir)
      for (const n of ['a', 'b', 'c', 'd']) writeFileSync(join(tplDir, `${n}.ejs`), '')
      writeFileSync(join(testDir, 'r.test.ts'), 'a.ejs')
      writeFileSync(baseline, '3')
      const r = run(tplDir, testDir, baseline)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('3/4')
      expect(r.stdout).toContain('75%')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when coverage improved but the baseline was not banked', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const tplDir = join(dir, 'templates')
      const testDir = join(dir, 'tests')
      const baseline = join(dir, 'baseline.txt')
      mkdirSync(tplDir)
      mkdirSync(testDir)
      for (const n of ['a', 'b']) writeFileSync(join(tplDir, `${n}.ejs`), '')
      writeFileSync(join(testDir, 'r.test.ts'), 'a.ejs')
      writeFileSync(baseline, '3')
      const r = run(tplDir, testDir, baseline)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('--update-baseline')
    } finally {
      cleanup()
    }
  })
})
