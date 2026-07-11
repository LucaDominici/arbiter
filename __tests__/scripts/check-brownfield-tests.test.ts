import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-brownfield-tests.mjs')

function run(
  generatorsDir: string,
  testsDir: string,
  baselineFile: string,
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(
    'node',
    [SCRIPT, `--generators=${generatorsDir}`, `--tests=${testsDir}`, `--baseline=${baselineFile}`],
    { encoding: 'utf-8', cwd: resolve('.') },
  )
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'canon11-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-brownfield-tests.mjs (CANON-11)', () => {
  it('exits 0 when every generator has a brownfield test mentioning its stem', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const genDir = join(dir, 'generators')
      const testDir = join(dir, 'brownfield')
      const baseline = join(dir, 'baseline.txt')
      mkdirSync(genDir)
      mkdirSync(testDir)
      writeFileSync(join(genDir, 'foo.ts'), 'export function generateFoo() {}')
      writeFileSync(join(testDir, 'foo-brownfield.test.ts'), "describe('foo', () => {})")
      writeFileSync(baseline, '0')
      expect(run(genDir, testDir, baseline).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('[RED] exits 1 when an uncovered generator pushes the count above baseline', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const genDir = join(dir, 'generators')
      const testDir = join(dir, 'brownfield')
      const baseline = join(dir, 'baseline.txt')
      mkdirSync(genDir)
      mkdirSync(testDir)
      writeFileSync(join(genDir, 'foo.ts'), '')
      writeFileSync(join(genDir, 'bar.ts'), '')
      // Only 'foo' covered — 1 missing, baseline was 0.
      writeFileSync(join(testDir, 'foo-brownfield.test.ts'), 'foo')
      writeFileSync(baseline, '0')
      const result = run(genDir, testDir, baseline)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('regression')
      expect(result.stdout).toContain('bar.ts')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when the uncovered count matches the committed baseline (no new regression)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const genDir = join(dir, 'generators')
      const testDir = join(dir, 'brownfield')
      const baseline = join(dir, 'baseline.txt')
      mkdirSync(genDir)
      mkdirSync(testDir)
      writeFileSync(join(genDir, 'foo.ts'), '')
      writeFileSync(join(genDir, 'bar.ts'), '')
      writeFileSync(join(testDir, 'foo-brownfield.test.ts'), 'foo')
      writeFileSync(baseline, '1')
      expect(run(genDir, testDir, baseline).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('--update-baseline writes the current uncovered count', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const genDir = join(dir, 'generators')
      const testDir = join(dir, 'brownfield')
      const baseline = join(dir, 'baseline.txt')
      mkdirSync(genDir)
      mkdirSync(testDir)
      writeFileSync(join(genDir, 'foo.ts'), '')
      writeFileSync(join(genDir, 'bar.ts'), '')
      writeFileSync(join(testDir, 'foo-brownfield.test.ts'), 'foo')
      const r = spawnSync(
        'node',
        [
          SCRIPT,
          `--generators=${genDir}`,
          `--tests=${testDir}`,
          `--baseline=${baseline}`,
          '--update-baseline',
        ],
        { encoding: 'utf-8', cwd: resolve('.') },
      )
      expect(r.status).toBe(0)
      expect(run(genDir, testDir, baseline).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('passes against the real generators, brownfield tests, and committed baseline', () => {
    const result = run(
      resolve('src/generators'),
      resolve('__tests__/brownfield'),
      resolve('.brownfield-tests-baseline.txt'),
    )
    expect(result.status).toBe(0)
  })
})
