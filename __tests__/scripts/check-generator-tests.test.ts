import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-generator-tests.mjs')

function run(generatorsDir: string, testsDir: string) {
  const r = spawnSync('node', [SCRIPT, `--generators=${generatorsDir}`, `--tests=${testsDir}`], {
    encoding: 'utf-8',
    cwd: resolve('.'),
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'canon05-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-generator-tests.mjs (INV-49 / CANON-05)', () => {
  it('exits 0 when every generator has a matching test', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const genDir = join(dir, 'generators')
      const testDir = join(dir, 'tests')
      mkdirSync(genDir)
      mkdirSync(testDir)
      writeFileSync(join(genDir, 'foo.ts'), '')
      writeFileSync(join(genDir, 'bar.ts'), '')
      writeFileSync(join(testDir, 'foo.test.ts'), '')
      writeFileSync(join(testDir, 'bar.test.ts'), '')
      expect(run(genDir, testDir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a generator has no test', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const genDir = join(dir, 'generators')
      const testDir = join(dir, 'tests')
      mkdirSync(genDir)
      mkdirSync(testDir)
      writeFileSync(join(genDir, 'foo.ts'), '')
      writeFileSync(join(genDir, 'bar.ts'), '')
      writeFileSync(join(testDir, 'foo.test.ts'), '')
      // bar.test.ts missing
      const result = run(genDir, testDir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('bar.test.ts')
    } finally {
      cleanup()
    }
  })

  it('ignores .d.ts declaration files', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const genDir = join(dir, 'generators')
      const testDir = join(dir, 'tests')
      mkdirSync(genDir)
      mkdirSync(testDir)
      writeFileSync(join(genDir, 'foo.ts'), '')
      writeFileSync(join(genDir, 'foo.d.ts'), '')
      writeFileSync(join(testDir, 'foo.test.ts'), '')
      expect(run(genDir, testDir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('reports all missing tests, not just the first', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const genDir = join(dir, 'generators')
      const testDir = join(dir, 'tests')
      mkdirSync(genDir)
      mkdirSync(testDir)
      writeFileSync(join(genDir, 'alpha.ts'), '')
      writeFileSync(join(genDir, 'beta.ts'), '')
      writeFileSync(join(genDir, 'gamma.ts'), '')
      const result = run(genDir, testDir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('alpha.test.ts')
      expect(result.stdout).toContain('beta.test.ts')
      expect(result.stdout).toContain('gamma.test.ts')
    } finally {
      cleanup()
    }
  })

  it('passes against the real src/generators and __tests__/generators', () => {
    const result = run(resolve('src/generators'), resolve('__tests__/generators'))
    expect(result.status).toBe(0)
  })
})
