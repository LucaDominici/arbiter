// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectBrownfieldClass } from '../../src/kit/brownfield-detect.js'

function makeRepo(fileCount: number, ext: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-bd-'))
  const srcDir = join(dir, 'src')
  mkdirSync(srcDir)
  for (let i = 0; i < fileCount; i++) {
    writeFileSync(join(srcDir, `File${i}${ext}`), '')
  }
  return dir
}

function addJacocoCsv(repoDir: string, missedLines: number, coveredLines: number): void {
  const jacocoDir = join(repoDir, 'target', 'site', 'jacoco')
  mkdirSync(jacocoDir, { recursive: true })
  const header = 'GROUP,PACKAGE,CLASS,IM,IC,BM,BC,LINE_MISSED,LINE_COVERED,CM,CC,MM,MC\n'
  const row = `app,com,Foo,0,0,0,0,${missedLines},${coveredLines},0,0,0,0\n`
  writeFileSync(join(jacocoDir, 'jacoco.csv'), header + row)
}

function addVitestCoverage(repoDir: string, pct: number): void {
  const covDir = join(repoDir, 'coverage')
  mkdirSync(covDir, { recursive: true })
  writeFileSync(
    join(covDir, 'coverage-summary.json'),
    JSON.stringify({ total: { lines: { pct } } }),
  )
}

/** Cobertura XML with the given overall line-rate (a 0–1 fraction). */
function addCoberturaXml(repoDir: string, fileName: string, lineRate: number): void {
  writeFileSync(
    join(repoDir, fileName),
    `<?xml version="1.0" ?>\n<coverage line-rate="${lineRate}" branch-rate="0" version="1.0">\n  <packages/>\n</coverage>\n`,
  )
}

/** pytest-cov coverage.json (totals.percent_covered is a 0–100 percentage). */
function addPythonCoverageJson(repoDir: string, percentCovered: number): void {
  writeFileSync(
    join(repoDir, 'coverage.json'),
    JSON.stringify({ totals: { percent_covered: percentCovered } }),
  )
}

/** Go `go tool cover` profile: each block is `file:sL.sC,eL.eC numStmts count`. */
function addGoCoverageOut(repoDir: string, coveredStmts: number, uncoveredStmts: number): void {
  const lines = ['mode: set']
  for (let i = 0; i < coveredStmts; i++) {
    lines.push(`pkg/f.go:${i + 1}.1,${i + 1}.20 1 1`)
  }
  for (let i = 0; i < uncoveredStmts; i++) {
    lines.push(`pkg/g.go:${i + 1}.1,${i + 1}.20 1 0`)
  }
  writeFileSync(join(repoDir, 'coverage.out'), lines.join('\n') + '\n')
}

let repoDir: string

beforeEach(() => {
  repoDir = ''
})

afterEach(() => {
  if (repoDir) rmSync(repoDir, { recursive: true, force: true })
})

describe('detectBrownfieldClass — gold (< 50 files)', () => {
  it('classifies repo with 10 java files as gold', () => {
    repoDir = makeRepo(10, '.java')
    const result = detectBrownfieldClass(repoDir, 'java')
    expect(result.brownfieldClass).toBe('gold')
    expect(result.sourceFileCount).toBe(10)
    expect(result.coverageUsed).toBe(false)
  })

  it('classifies empty repo as gold', () => {
    repoDir = mkdtempSync(join(tmpdir(), 'arbiter-bd-'))
    const result = detectBrownfieldClass(repoDir, 'java')
    expect(result.brownfieldClass).toBe('gold')
    expect(result.sourceFileCount).toBe(0)
  })
})

describe('detectBrownfieldClass — light (50–500 files, no coverage)', () => {
  it('classifies 100-file java repo as light when no coverage report', () => {
    repoDir = makeRepo(100, '.java')
    const result = detectBrownfieldClass(repoDir, 'java')
    expect(result.brownfieldClass).toBe('light')
    expect(result.sourceFileCount).toBe(100)
    expect(result.coverageUsed).toBe(false)
  })

  it('classifies 100-file typescript repo as light when no coverage', () => {
    repoDir = makeRepo(100, '.ts')
    const result = detectBrownfieldClass(repoDir, 'typescript')
    expect(result.brownfieldClass).toBe('light')
  })
})

describe('detectBrownfieldClass — medium boundary with coverage', () => {
  it('classifies 100-file java repo with 20% coverage as medium', () => {
    repoDir = makeRepo(100, '.java')
    // 80 missed, 20 covered = 20% line coverage
    addJacocoCsv(repoDir, 80, 20)
    const result = detectBrownfieldClass(repoDir, 'java')
    expect(result.brownfieldClass).toBe('medium')
    expect(result.coverageUsed).toBe(true)
    expect(result.coverageRatio).toBeCloseTo(0.2)
  })

  it('classifies 100-file java repo with 50% coverage as light', () => {
    repoDir = makeRepo(100, '.java')
    addJacocoCsv(repoDir, 50, 50)
    const result = detectBrownfieldClass(repoDir, 'java')
    expect(result.brownfieldClass).toBe('light')
    expect(result.coverageRatio).toBeCloseTo(0.5)
  })
})

describe('detectBrownfieldClass — heavy (2000+ files)', () => {
  it('classifies repo with 2001 java files as heavy regardless of coverage', () => {
    repoDir = makeRepo(2001, '.java')
    const result = detectBrownfieldClass(repoDir, 'java')
    expect(result.brownfieldClass).toBe('heavy')
    expect(result.sourceFileCount).toBe(2001)
  })
})

describe('detectBrownfieldClass — typescript coverage (vitest)', () => {
  it('reads coverage-summary.json for typescript repos and applies coverage boundary', () => {
    repoDir = makeRepo(100, '.ts')
    // 15% coverage → below 30% threshold → medium
    addVitestCoverage(repoDir, 15)
    const result = detectBrownfieldClass(repoDir, 'typescript')
    expect(result.brownfieldClass).toBe('medium')
    expect(result.coverageUsed).toBe(true)
    expect(result.coverageRatio).toBeCloseTo(0.15)
  })

  it('classifies typescript repo with 60% vitest coverage as light', () => {
    repoDir = makeRepo(100, '.ts')
    addVitestCoverage(repoDir, 60)
    const result = detectBrownfieldClass(repoDir, 'typescript')
    expect(result.brownfieldClass).toBe('light')
  })
})

// ─── Python coverage (coverage.xml / coverage.json) — #1584 ───────────────────

describe('detectBrownfieldClass — python coverage', () => {
  it('reads coverage.xml line-rate (a 0–1 fraction, NOT a percentage)', () => {
    repoDir = makeRepo(100, '.py')
    addCoberturaXml(repoDir, 'coverage.xml', 0.2) // 20% → below 30% → medium
    const result = detectBrownfieldClass(repoDir, 'python')
    expect(result.coverageUsed).toBe(true)
    expect(result.coverageRatio).toBeCloseTo(0.2)
    expect(result.brownfieldClass).toBe('medium')
  })

  it('reads pytest-cov coverage.json totals.percent_covered (a 0–100 percentage)', () => {
    repoDir = makeRepo(100, '.py')
    addPythonCoverageJson(repoDir, 12) // 12% → medium
    const result = detectBrownfieldClass(repoDir, 'python')
    expect(result.coverageRatio).toBeCloseTo(0.12)
    expect(result.brownfieldClass).toBe('medium')
  })

  it('REGRESSION: a low-coverage 100-file python repo is NOT classified light', () => {
    // Before #1584 no python reader ran → coverageRatio stayed null → lenient "light".
    repoDir = makeRepo(100, '.py')
    addCoberturaXml(repoDir, 'coverage.xml', 0.03) // 3% coverage
    const result = detectBrownfieldClass(repoDir, 'python')
    expect(result.brownfieldClass).not.toBe('light')
    expect(result.brownfieldClass).toBe('medium')
  })

  it('REGRESSION: a low-coverage 600-file python repo classifies heavy, not medium', () => {
    repoDir = makeRepo(600, '.py')
    addPythonCoverageJson(repoDir, 3) // 3% → below 5% → heavy
    const result = detectBrownfieldClass(repoDir, 'python')
    expect(result.brownfieldClass).toBe('heavy')
  })
})

// ─── Go coverage (coverage.out) — #1584 ───────────────────────────────────────

describe('detectBrownfieldClass — go coverage', () => {
  it('reads coverage.out statement coverage and applies the boundary', () => {
    repoDir = makeRepo(100, '.go')
    addGoCoverageOut(repoDir, 20, 80) // 20/100 = 20% → medium
    const result = detectBrownfieldClass(repoDir, 'go')
    expect(result.coverageUsed).toBe(true)
    expect(result.coverageRatio).toBeCloseTo(0.2)
    expect(result.brownfieldClass).toBe('medium')
  })

  it('classifies a well-tested go repo as light', () => {
    repoDir = makeRepo(100, '.go')
    addGoCoverageOut(repoDir, 70, 30) // 70% → light
    const result = detectBrownfieldClass(repoDir, 'go')
    expect(result.brownfieldClass).toBe('light')
  })

  it('REGRESSION: a low-coverage 100-file go repo is NOT classified light', () => {
    repoDir = makeRepo(100, '.go')
    addGoCoverageOut(repoDir, 4, 96) // 4% coverage
    const result = detectBrownfieldClass(repoDir, 'go')
    expect(result.brownfieldClass).not.toBe('light')
    expect(result.brownfieldClass).toBe('medium')
  })
})

// ─── Rust coverage (cargo-llvm-cov cobertura) — #1584 ─────────────────────────

describe('detectBrownfieldClass — rust coverage', () => {
  it('reads cobertura line-rate from cargo-llvm-cov output', () => {
    repoDir = makeRepo(100, '.rs')
    addCoberturaXml(repoDir, 'cobertura.xml', 0.18) // 18% → medium
    const result = detectBrownfieldClass(repoDir, 'rust')
    expect(result.coverageUsed).toBe(true)
    expect(result.coverageRatio).toBeCloseTo(0.18)
    expect(result.brownfieldClass).toBe('medium')
  })

  it('REGRESSION: a low-coverage 100-file rust repo is NOT classified light', () => {
    repoDir = makeRepo(100, '.rs')
    addCoberturaXml(repoDir, 'cobertura.xml', 0.02) // 2% coverage
    const result = detectBrownfieldClass(repoDir, 'rust')
    expect(result.brownfieldClass).not.toBe('light')
    expect(result.brownfieldClass).toBe('medium')
  })
})

// ─── multi chains all readers — #1584 ─────────────────────────────────────────

describe('detectBrownfieldClass — multi chains every language reader', () => {
  it('picks up a python coverage.xml in a multi-language scan', () => {
    repoDir = makeRepo(100, '.py')
    addCoberturaXml(repoDir, 'coverage.xml', 0.1) // 10% → medium
    const result = detectBrownfieldClass(repoDir, 'multi')
    expect(result.coverageUsed).toBe(true)
    expect(result.brownfieldClass).toBe('medium')
  })

  it('picks up a go coverage.out in a multi-language scan', () => {
    repoDir = makeRepo(100, '.go')
    addGoCoverageOut(repoDir, 10, 90) // 10% → medium
    const result = detectBrownfieldClass(repoDir, 'multi')
    expect(result.coverageUsed).toBe(true)
    expect(result.brownfieldClass).toBe('medium')
  })
})
