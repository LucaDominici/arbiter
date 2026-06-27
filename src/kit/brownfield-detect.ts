// SPDX-License-Identifier: Apache-2.0
import { readdirSync, lstatSync, existsSync, readFileSync } from 'node:fs'
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
      // lstatSync (not statSync) so a symlinked directory reports isDirectory() === false and is
      // skipped (#1645): following symlinks let a cycle (e.g. `current -> .`) re-walk to the depth
      // cap and let an out-of-repo symlink (e.g. `-> /usr`) inflate sourceFileCount, skewing the
      // brownfield band. Mirrors the cycle-safe lstatSync walk in measure.ts findRecursive.
      st = lstatSync(full)
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

/**
 * Read the overall `line-rate` (already a 0–1 ratio) from a Cobertura XML report at
 * one of the candidate paths. Shared by the Python (`coverage xml`) and Rust
 * (`cargo-llvm-cov --cobertura`) readers. Returns null if absent/unparseable or the
 * rate is outside [0,1]. Does NOT divide — a Cobertura `line-rate` is a fraction,
 * not a 0–100 percentage (#1584).
 */
function readCoberturaLineRate(candidatePaths: string[]): number | null {
  for (const xmlPath of candidatePaths) {
    if (!existsSync(xmlPath)) continue
    try {
      const xml = readFileSync(xmlPath, 'utf8')
      // The root <coverage …> element carries the aggregate line-rate.
      const match = /<coverage\b[^>]*\bline-rate="([0-9.]+)"/.exec(xml)
      if (!match) continue
      const rate = Number(match[1])
      if (!isNaN(rate) && rate >= 0 && rate <= 1) return rate
    } catch {
      continue
    }
  }
  return null
}

/**
 * Parse a Python coverage report and return line-coverage ratio (0–1). Prefers
 * `coverage.xml` (Cobertura `line-rate`), then `coverage.json` (pytest-cov:
 * `totals.percent_covered` is a 0–100 percentage → /100). Returns null if neither
 * is present/parseable.
 */
function readPythonCoverage(repoPath: string): number | null {
  const xmlRate = readCoberturaLineRate([join(repoPath, 'coverage.xml')])
  if (xmlRate !== null) return xmlRate
  const jsonPath = join(repoPath, 'coverage.json')
  if (existsSync(jsonPath)) {
    try {
      const raw = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
        totals?: { percent_covered?: number }
      }
      const pct = raw.totals?.percent_covered
      if (typeof pct === 'number') return pct / 100
    } catch {
      // fall through to null
    }
  }
  return null
}

/**
 * Parse a Go `go tool cover` profile (`coverage.out`) and return the
 * statement-coverage ratio (0–1): covered statements / total statements. Each
 * profile block is `file:sL.sC,eL.eC numStmts count`; a block counts as covered
 * when `count > 0` (set/count/atomic modes). Returns null if absent, unparseable,
 * or empty.
 */
function readGoCoverage(repoPath: string): number | null {
  const candidatePaths = [join(repoPath, 'coverage.out'), join(repoPath, 'cover.out')]
  for (const profilePath of candidatePaths) {
    if (!existsSync(profilePath)) continue
    try {
      const lines = readFileSync(profilePath, 'utf8').trim().split('\n')
      let total = 0
      let covered = 0
      for (const line of lines) {
        if (line.startsWith('mode:') || line.trim() === '') continue
        const parts = line.trim().split(/\s+/)
        if (parts.length < 3) continue
        const numStmts = Number(parts[parts.length - 2])
        const count = Number(parts[parts.length - 1])
        if (isNaN(numStmts) || isNaN(count)) continue
        total += numStmts
        if (count > 0) covered += numStmts
      }
      if (total === 0) return null
      return covered / total
    } catch {
      continue
    }
  }
  return null
}

/**
 * Parse a Rust `cargo-llvm-cov --cobertura` report and return line-coverage ratio
 * (0–1) from the Cobertura `line-rate`. Returns null if absent/unparseable.
 */
function readRustCoverage(repoPath: string): number | null {
  return readCoberturaLineRate([
    join(repoPath, 'cobertura.xml'),
    join(repoPath, 'target', 'llvm-cov', 'cobertura.xml'),
    join(repoPath, 'target', 'nextest', 'cobertura.xml'),
  ])
}

/**
 * Select and run the coverage reader(s) for a language, returning the first
 * measurable line/statement-coverage ratio (0–1) or null. For `multi`, the readers
 * are chained jacoco → vitest → python → go → rust so a polyglot repo with any one
 * report is still measured. Wiring every language (not just JVM/TS) is what stops
 * under-tested Go/Python/Rust repos from being misclassified into the lenient band
 * by the null short-circuit (#1584).
 */
function readCoverage(repoPath: string, language: string): number | null {
  const byLanguage: Record<string, (p: string) => number | null> = {
    java: readJacocoCoverage,
    typescript: readVitestCoverage,
    python: readPythonCoverage,
    go: readGoCoverage,
    rust: readRustCoverage,
  }
  if (language === 'multi') {
    const chain = [
      readJacocoCoverage,
      readVitestCoverage,
      readPythonCoverage,
      readGoCoverage,
      readRustCoverage,
    ]
    for (const reader of chain) {
      const ratio = reader(repoPath)
      if (ratio !== null) return ratio
    }
    return null
  }
  const reader = byLanguage[language]
  return reader ? reader(repoPath) : null
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
 *
 * Coverage is read for every supported language — java (jacoco), typescript
 * (vitest), python (coverage.xml/json), go (coverage.out), rust (cargo-llvm-cov) —
 * so a low-coverage non-JVM/TS repo is no longer mis-classified into the lenient
 * band by an always-null coverage short-circuit (#1584).
 */
export function detectBrownfieldClass(repoPath: string, language: string): BrownfieldDetectResult {
  const exts = getSourceExts(language)
  const sourceFileCount = countSourceFiles(repoPath, exts)

  const coverageRatio = readCoverage(repoPath, language)
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
