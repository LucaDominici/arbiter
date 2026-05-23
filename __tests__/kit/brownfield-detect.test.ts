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
