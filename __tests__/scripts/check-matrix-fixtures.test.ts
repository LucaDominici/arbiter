import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-matrix-fixtures.mjs')
const REAL_MATRIX = resolve('src/compatibility/cross-language-matrix.json')

function run(
  fixturesDir: string,
  matrixPath = REAL_MATRIX,
): {
  status: number
  stdout: string
  stderr: string
} {
  const r = spawnSync('node', [SCRIPT, `--fixtures-dir=${fixturesDir}`, `--matrix=${matrixPath}`], {
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
  const dir = mkdtempSync(join(tmpdir(), 'matrix-fixtures-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function addFixture(fixturesDir: string, name: string, manifest: Record<string, unknown>): void {
  const dir = join(fixturesDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
}

function makeMatrix(languages: string[], maturity: string): Record<string, unknown> {
  return {
    coverage: Object.fromEntries(
      languages.map((lang) => [lang, { tool: 'x', maturity, reason: 'test' }]),
    ),
  }
}

describe('check-matrix-fixtures.mjs', () => {
  it('exits 0 when every proven language has a fixture', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const matrix = makeMatrix(['typescript', 'java'], 'proven')
      const matrixFile = join(dir, 'matrix.json')
      writeFileSync(matrixFile, JSON.stringify(matrix))
      const fixturesDir = join(dir, 'fixtures')
      addFixture(fixturesDir, 'ts-lib', {
        language: 'typescript',
        archetype: 'library',
        levels: ['L1'],
      })
      addFixture(fixturesDir, 'java-lib', {
        language: 'java',
        archetype: 'library',
        levels: ['L1'],
      })
      const result = run(fixturesDir, matrixFile)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a proven language has no fixture', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const matrix = makeMatrix(['typescript', 'rust'], 'proven')
      const matrixFile = join(dir, 'matrix.json')
      writeFileSync(matrixFile, JSON.stringify(matrix))
      const fixturesDir = join(dir, 'fixtures')
      addFixture(fixturesDir, 'ts-lib', {
        language: 'typescript',
        archetype: 'library',
        levels: ['L1'],
      })
      // No rust fixture — violation
      const result = run(fixturesDir, matrixFile)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('rust')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a fixture dir is missing manifest.json', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const matrix = makeMatrix(['typescript'], 'proven')
      const matrixFile = join(dir, 'matrix.json')
      writeFileSync(matrixFile, JSON.stringify(matrix))
      const fixturesDir = join(dir, 'fixtures')
      // Dir exists but no manifest
      mkdirSync(join(fixturesDir, 'ts-lib'), { recursive: true })
      const result = run(fixturesDir, matrixFile)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('manifest.json')
    } finally {
      cleanup()
    }
  })

  it("exits 1 when manifest.json is missing required field 'language'", () => {
    const { dir, cleanup } = makeTemp()
    try {
      const matrix = makeMatrix(['typescript'], 'proven')
      const matrixFile = join(dir, 'matrix.json')
      writeFileSync(matrixFile, JSON.stringify(matrix))
      const fixturesDir = join(dir, 'fixtures')
      addFixture(fixturesDir, 'ts-lib', {
        archetype: 'library',
        levels: ['L1'],
        // missing language
      })
      const result = run(fixturesDir, matrixFile)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('language')
    } finally {
      cleanup()
    }
  })

  it("exits 1 when manifest.json is missing required field 'archetype'", () => {
    const { dir, cleanup } = makeTemp()
    try {
      const matrix = makeMatrix(['typescript'], 'proven')
      const matrixFile = join(dir, 'matrix.json')
      writeFileSync(matrixFile, JSON.stringify(matrix))
      const fixturesDir = join(dir, 'fixtures')
      addFixture(fixturesDir, 'ts-lib', {
        language: 'typescript',
        levels: ['L1'],
        // missing archetype
      })
      const result = run(fixturesDir, matrixFile)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('archetype')
    } finally {
      cleanup()
    }
  })

  it("exits 1 when manifest.json is missing required field 'levels'", () => {
    const { dir, cleanup } = makeTemp()
    try {
      const matrix = makeMatrix(['typescript'], 'proven')
      const matrixFile = join(dir, 'matrix.json')
      writeFileSync(matrixFile, JSON.stringify(matrix))
      const fixturesDir = join(dir, 'fixtures')
      addFixture(fixturesDir, 'ts-lib', {
        language: 'typescript',
        archetype: 'library',
        // missing levels
      })
      const result = run(fixturesDir, matrixFile)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('levels')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when manifest.json contains invalid JSON', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const matrix = makeMatrix(['typescript'], 'proven')
      const matrixFile = join(dir, 'matrix.json')
      writeFileSync(matrixFile, JSON.stringify(matrix))
      const fixturesDir = join(dir, 'fixtures')
      mkdirSync(join(fixturesDir, 'ts-lib'), { recursive: true })
      writeFileSync(join(fixturesDir, 'ts-lib', 'manifest.json'), '{bad json')
      const result = run(fixturesDir, matrixFile)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('invalid JSON')
    } finally {
      cleanup()
    }
  })

  it('skips languages with only non-proven cells (beta/unsafe/unavailable)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const matrix = {
        mutation: {
          typescript: { tool: 'stryker', maturity: 'proven', reason: 'ok' },
          rust: { tool: 'mutants', maturity: 'beta', reason: 'unstable' },
        },
      }
      const matrixFile = join(dir, 'matrix.json')
      writeFileSync(matrixFile, JSON.stringify(matrix))
      const fixturesDir = join(dir, 'fixtures')
      addFixture(fixturesDir, 'ts-lib', {
        language: 'typescript',
        archetype: 'library',
        levels: ['L1'],
      })
      // No rust fixture — ok since rust only has beta, not proven
      const result = run(fixturesDir, matrixFile)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('passes with the real fixtures directory', () => {
    const fixturesDir = resolve('__tests__/fixtures/real-projects')
    const result = run(fixturesDir, REAL_MATRIX)
    expect(result.status).toBe(0)
  })
})
