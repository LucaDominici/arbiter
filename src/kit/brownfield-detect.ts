// SPDX-License-Identifier: Apache-2.0
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import type { BrownfieldClass } from './thresholds.js'

/** Source file extensions counted per stack. */
const SOURCE_EXTENSIONS: Record<string, Set<string>> = {
  java: new Set(['.java']),
  typescript: new Set(['.ts', '.tsx']),
  python: new Set(['.py']),
  go: new Set(['.go']),
  rust: new Set(['.rs']),
  multi: new Set(['.java', '.ts', '.tsx', '.py', '.go', '.rs']),
}

const FALLBACK_EXTS = new Set(['.java', '.ts', '.tsx', '.py', '.go', '.rs'])

function getSourceExts(language: string): Set<string> {
  const found = SOURCE_EXTENSIONS[language]
  return found !== undefined ? found : FALLBACK_EXTS
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'target',
  'build',
  'dist',
  '.gradle',
  '__pycache__',
  '.mypy_cache',
  '.ruff_cache',
  'vendor',
  '.next',
  'out',
  'coverage',
  '.nyc_output',
  'htmlcov',
])

function countSourceFiles(dir: string, exts: Set<string>, depth = 0): number {
  if (depth > 12) return 0
  let count = 0
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (!entry.startsWith('.') || entry === '.github') {
        count += countSourceFiles(full, exts, depth + 1)
      }
    } else if (exts.has(extname(entry))) {
      count++
    }
  }
  return count
}

/**
 * Parse JaCoCo CSV report and return line-coverage ratio (0–1).
 * Returns null if the report is absent or unparseable.
 */
function readJacocoCoverage(repoPath: string): number | null {
  const candidatePaths = [
    join(repoPath, 'target', 'site', 'jacoco', 'jacoco.csv'),
    join(repoPath, 'build', 'reports', 'jacoco', 'test', 'jacoco.csv'),
  ]
  for (const csvPath of candidatePaths) {
    if (!existsSync(csvPath)) continue
    try {
      const lines = readFileSync(csvPath, 'utf8').trim().split('\n')
      let missed = 0
      let covered = 0
      for (const line of lines.slice(1)) {
        const cols = line.split(',')
        // CSV: GROUP,PACKAGE,CLASS,INSTRUCTION_MISSED,INSTRUCTION_COVERED,BRANCH_MISSED,BRANCH_COVERED,LINE_MISSED,LINE_COVERED,...
        const lineMissed = Number(cols[7])
        const lineCovered = Number(cols[8])
        if (!isNaN(lineMissed)) missed += lineMissed
        if (!isNaN(lineCovered)) covered += lineCovered
      }
      const total = missed + covered
      if (total === 0) return null
      return covered / total
    } catch {
      continue
    }
  }
  return null
}

/**
 * Parse Vitest/Istanbul coverage-summary.json and return line-coverage ratio (0–1).
 * Returns null if absent or unparseable.
 */
function readVitestCoverage(repoPath: string): number | null {
  const candidatePaths = [
    join(repoPath, 'coverage', 'coverage-summary.json'),
    join(repoPath, '.coverage', 'coverage-summary.json'),
  ]
  for (const summaryPath of candidatePaths) {
    if (!existsSync(summaryPath)) continue
    try {
      const raw = JSON.parse(readFileSync(summaryPath, 'utf8')) as Record<
        string,
        { lines?: { pct?: number } }
      >
      const total = raw['total']
      const pct = total?.lines?.pct
      if (typeof pct === 'number') return pct / 100
    } catch {
      continue
    }
  }
  return null
}

export interface BrownfieldDetectResult {
  /** Detected brownfield class. */
  brownfieldClass: BrownfieldClass
  /** Number of source files counted. */
  sourceFileCount: number
  /** Detected line coverage ratio (0–1), null if not measurable. */
  coverageRatio: number | null
  /** Whether coverage was available and used in classification. */
  coverageUsed: boolean
}

/**
 * Auto-detect the brownfield class of a repository.
 *
 * Heuristics (file-count primary, coverage refines light vs medium boundary):
 *   gold   → < 50 source files
 *   light  → 50–500 files, coverage > 30 %
 *   medium → 500–2 000 files, coverage 5–30 %
 *   heavy  → 2 000+ files, coverage < 5 %
 *
 * When coverage is unavailable, the boundary between light/medium/heavy
 * is decided by file count alone, with light = 50–500 and medium = 500–2000.
 */
export function detectBrownfieldClass(repoPath: string, language: string): BrownfieldDetectResult {
  const exts = getSourceExts(language)
  const sourceFileCount = countSourceFiles(repoPath, exts)

  let coverageRatio: number | null = null
  if (language === 'java' || language === 'multi') {
    coverageRatio = readJacocoCoverage(repoPath)
  }
  if (language === 'typescript' || (language === 'multi' && coverageRatio === null)) {
    coverageRatio = readVitestCoverage(repoPath)
  }

  const coverageUsed = coverageRatio !== null

  let brownfieldClass: BrownfieldClass
  if (sourceFileCount < 50) {
    brownfieldClass = 'gold'
  } else if (sourceFileCount < 500) {
    // light/medium boundary: coverage > 30 % → light; else medium
    brownfieldClass = coverageRatio === null || coverageRatio > 0.3 ? 'light' : 'medium'
  } else if (sourceFileCount < 2000) {
    // medium/heavy boundary: coverage 5–30 % → medium; < 5 % → heavy
    brownfieldClass = coverageRatio === null || coverageRatio >= 0.05 ? 'medium' : 'heavy'
  } else {
    brownfieldClass = 'heavy'
  }

  return { brownfieldClass, sourceFileCount, coverageRatio, coverageUsed }
}
