// SPDX-License-Identifier: Apache-2.0
/**
 * Measures a KIT catalog dimension against the actual repo state.
 *
 * Evidence paths are POSIX-relative (no leading slash, no backslashes),
 * sorted lexicographically, deduplicated — deterministic across repeated calls.
 *
 * Issue: #1043
 */

import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { KitDimension } from './schema.js'

export interface MeasureResult {
  status: 'present' | 'partial' | 'missing'
  evidence: string[]
}

// ─── Module-level state ───────────────────────────────────────────────────────

let diagnosticErrors = 0

/** Workflow file content cache keyed by repoRoot → filename → content. */
const workflowCache = new Map<string, Map<string, string>>()

/** package.json content cache keyed by repoRoot. */
const pkgCache = new Map<string, Record<string, unknown> | null>()

/** Reset caches and diagnostic counter — call in tests to prevent cross-test pollution. */
export function clearMeasureCache(): void {
  workflowCache.clear()
  pkgCache.clear()
  diagnosticErrors = 0
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'target',
  'build',
  '.gradle',
  'vendor',
  '__pycache__',
  '.mypy_cache',
  '.ruff_cache',
  '.next',
  'out',
  'coverage',
  '.nyc_output',
])

const EVIDENCE_CAP = 20

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toPosixRelative(repoRoot: string, absPath: string): string {
  return relative(repoRoot, absPath).replace(/\\/g, '/')
}

function readPkgJson(repoRoot: string): Record<string, unknown> | null {
  const cached = pkgCache.get(repoRoot)
  if (cached !== undefined) return cached
  const pkgPath = join(repoRoot, 'package.json')
  if (!existsSync(pkgPath)) {
    pkgCache.set(repoRoot, null)
    return null
  }
  try {
    const raw = readFileSync(pkgPath, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    pkgCache.set(repoRoot, parsed)
    return parsed
  } catch {
    pkgCache.set(repoRoot, null)
    return null
  }
}

function hasDep(pkg: Record<string, unknown> | null, name: string): boolean {
  if (!pkg) return false
  const deps = (pkg.dependencies ?? {}) as Record<string, unknown>
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, unknown>
  const peerDeps = (pkg.peerDependencies ?? {}) as Record<string, unknown>
  return name in deps || name in devDeps || name in peerDeps
}

function hasScript(pkg: Record<string, unknown> | null, key: string): boolean {
  if (!pkg) return false
  const scripts = (pkg.scripts ?? {}) as Record<string, unknown>
  return key in scripts
}

/**
 * Returns true if the file at absPath contains pattern.
 * Guards against large files (>1 MB) and non-regular files.
 */
function fileContains(absPath: string, pattern: RegExp | string): boolean {
  try {
    const st = statSync(absPath)
    if (!st.isFile() || st.size > 1_048_576) {
      if (st.size > 1_048_576) {
        process.stderr.write(`[measure] skipping large file: ${absPath}\n`)
      }
      return false
    }
    const content = readFileSync(absPath, 'utf8')
    if (typeof pattern === 'string') return content.includes(pattern)
    return pattern.test(content)
  } catch {
    return false
  }
}

/**
 * Recursively collects absolute paths matching matchFn.
 * Skips SKIP_DIRS and depth > maxDepth. Caps results at EVIDENCE_CAP.
 */
function visitEntry(
  full: string,
  entry: string,
  matchFn: (name: string) => boolean,
  remainingDepth: number,
  results: string[],
): void {
  let st
  try {
    st = lstatSync(full)
  } catch {
    return
  }
  if (st.isDirectory()) {
    findRecursive(full, matchFn, remainingDepth - 1, results)
  } else if (matchFn(entry)) {
    results.push(full)
  }
}

function findRecursive(
  dir: string,
  matchFn: (name: string) => boolean,
  remainingDepth = 12,
  results: string[] = [],
): string[] {
  if (remainingDepth < 0 || results.length >= EVIDENCE_CAP) return results
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return results
  }
  for (const entry of entries) {
    if (results.length >= EVIDENCE_CAP) break
    if (SKIP_DIRS.has(entry)) continue
    visitEntry(join(dir, entry), entry, matchFn, remainingDepth, results)
  }
  return results
}

/**
 * Returns a result with present if any of the relative paths exist, else missing.
 * Evidence paths are POSIX-relative from repoRoot, capped at EVIDENCE_CAP.
 */
function checkAny(repoRoot: string, relPaths: string[]): MeasureResult {
  const found: string[] = []
  for (const rel of relPaths) {
    if (found.length >= EVIDENCE_CAP) break
    const abs = join(repoRoot, rel)
    if (existsSync(abs)) found.push(rel.replace(/\\/g, '/'))
  }
  if (found.length === 0) return { status: 'missing', evidence: [] }
  return { status: 'present', evidence: found }
}

/**
 * Returns present if dir exists and has files (optionally filtered by ext).
 * Evidence is the list of matching POSIX-relative file paths.
 */
function checkDir(repoRoot: string, relDir: string, extFilter?: string): MeasureResult {
  const abs = join(repoRoot, relDir)
  if (!existsSync(abs)) return { status: 'missing', evidence: [] }
  let entries: string[]
  try {
    entries = readdirSync(abs)
  } catch {
    return { status: 'missing', evidence: [] }
  }
  const matching = entries
    .filter((f) => (extFilter ? f.endsWith(extFilter) : true))
    .filter((f) => {
      try {
        return statSync(join(abs, f)).isFile()
      } catch {
        return false
      }
    })
    .slice(0, EVIDENCE_CAP)
    .map((f) => toPosixRelative(repoRoot, join(abs, f)))
  if (matching.length === 0) return { status: 'missing', evidence: [] }
  return { status: 'present', evidence: matching }
}

function readWorkflowFile(abs: string): string | null {
  try {
    const st = statSync(abs)
    if (!st.isFile() || st.size > 1_048_576) return null
    return readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

/**
 * Returns workflow files whose content matches pattern.
 * Uses module-level cache populated once per repoRoot.
 */
function workflowsMatchingPattern(repoRoot: string, pattern: RegExp | string): string[] {
  let repoMap = workflowCache.get(repoRoot)
  if (!repoMap) {
    repoMap = new Map<string, string>()
    const wfDir = join(repoRoot, '.github', 'workflows')
    if (existsSync(wfDir)) {
      let entries: string[]
      try {
        entries = readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      } catch {
        entries = []
      }
      for (const f of entries) {
        const content = readWorkflowFile(join(wfDir, f))
        if (content !== null) repoMap.set(f, content)
      }
    }
    workflowCache.set(repoRoot, repoMap)
  }
  const results: string[] = []
  for (const [filename, content] of repoMap) {
    const matches = typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content)
    if (matches) {
      results.push(`.github/workflows/${filename}`)
    }
  }
  return results.sort()
}

function globWorkflows(repoRoot: string): string[] {
  const dir = join(repoRoot, '.github', 'workflows')
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .sort()
      .map((f) => toPosixRelative(repoRoot, join(dir, f)))
  } catch (err) {
    process.stderr.write(`[measure] readdirSync failed for ${dir}: ${String(err)}\n`)
    return []
  }
}

// ─── ArchUnit helper ──────────────────────────────────────────────────────────

function hasArchUnitDep(repoRoot: string): string[] {
  const pom = join(repoRoot, 'pom.xml')
  const gradle = join(repoRoot, 'build.gradle')
  const found: string[] = []
  if (fileContains(pom, 'archunit')) found.push('pom.xml')
  if (fileContains(gradle, 'archunit')) found.push('build.gradle')
  return found
}

function findArchTestClasses(repoRoot: string): string[] {
  const testDir = join(repoRoot, 'src', 'test')
  if (!existsSync(testDir)) return []
  return findRecursive(testDir, (name) => /ArchTest/i.test(name) && name.endsWith('.java')).map(
    (abs) => toPosixRelative(repoRoot, abs),
  )
}

function measureArchUnit(repoRoot: string): MeasureResult {
  const depFiles = hasArchUnitDep(repoRoot)
  if (depFiles.length === 0) return { status: 'missing', evidence: [] }
  const testClasses = findArchTestClasses(repoRoot)
  if (testClasses.length > 0) {
    return { status: 'present', evidence: [...depFiles, ...testClasses].slice(0, EVIDENCE_CAP) }
  }
  return { status: 'partial', evidence: depFiles }
}

// ─── Dispatch table ───────────────────────────────────────────────────────────

const DIM_HANDLERS: Partial<Record<string, (repoRoot: string) => MeasureResult>> = {
  // ── architecture ──────────────────────────────────────────────────────────
  N01: measureArchUnit,
  N02: measureArchUnit,
  N03: measureArchUnit,
  N04: measureArchUnit,
  N05: measureArchUnit,
  N06: measureArchUnit,
  N07: (r) => {
    const script = join(r, 'scripts', 'check-circular-deps.mjs')
    if (existsSync(script))
      return { status: 'present', evidence: ['scripts/check-circular-deps.mjs'] }
    const pkg = readPkgJson(r)
    if (hasDep(pkg, 'madge')) return { status: 'partial', evidence: ['package.json'] }
    return { status: 'missing', evidence: [] }
  },

  // ── audit_trail ───────────────────────────────────────────────────────────
  N08: (r) => {
    const abs = findRecursive(join(r, 'src'), (n) => /audit.*service|AuditEvent/i.test(n)).map(
      (a) => toPosixRelative(r, a),
    )
    if (abs.length === 0) return { status: 'missing', evidence: [] }
    return { status: 'present', evidence: abs.slice(0, EVIDENCE_CAP) }
  },
  N73: (r) => {
    const dirs = [join(r, 'db', 'migrations'), join(r, 'src', 'main', 'resources', 'db')]
    const found: string[] = []
    for (const d of dirs) {
      if (!existsSync(d)) continue
      found.push(...findRecursive(d, (n) => /audit/i.test(n)).map((a) => toPosixRelative(r, a)))
    }
    if (found.length === 0) return { status: 'missing', evidence: [] }
    return { status: 'present', evidence: found.slice(0, EVIDENCE_CAP) }
  },
  N74: (r) => {
    const dirs = [join(r, 'db', 'migrations'), join(r, 'src', 'main', 'resources', 'db')]
    const found: string[] = []
    for (const d of dirs) {
      if (!existsSync(d)) continue
      found.push(
        ...findRecursive(d, (n) => /trigger|audit_trigger/i.test(n)).map((a) =>
          toPosixRelative(r, a),
        ),
      )
    }
    if (found.length === 0) return { status: 'missing', evidence: [] }
    return { status: 'present', evidence: found.slice(0, EVIDENCE_CAP) }
  },
  N75: (r) => {
    const found = findRecursive(join(r, 'src'), (n) =>
      /AuditEvent.*Repository|AppendOnly/i.test(n),
    ).map((a) => toPosixRelative(r, a))
    if (found.length === 0) return { status: 'missing', evidence: [] }
    return { status: 'present', evidence: found.slice(0, EVIDENCE_CAP) }
  },

  // ── static_analysis ───────────────────────────────────────────────────────
  N09: (r) =>
    checkAny(r, [
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.json',
      '.eslintrc.yml',
      '.eslintrc.yaml',
      'eslint.config.js',
      'eslint.config.mjs',
      'eslint.config.cjs',
      '.golangci.yml',
      '.golangci.yaml',
      'ruff.toml',
      '.ruff.toml',
      'setup.cfg',
      '.clippy.toml',
    ]),
  N10: (r) =>
    checkAny(r, [
      '.prettierrc',
      '.prettierrc.js',
      '.prettierrc.cjs',
      '.prettierrc.json',
      '.prettierrc.yml',
      '.prettierrc.yaml',
      'prettier.config.js',
      'prettier.config.cjs',
      'prettier.config.mjs',
      'spotless.gradle',
      'rustfmt.toml',
    ]),
  N11: (r) => checkAny(r, ['pmd.xml', '.semgrep.yml', '.semgrep.yaml', 'semgrep-rules']),
  N12: (r) => checkAny(r, ['spotbugs.gradle', 'spotbugs-baseline.json']),
  N13: () => ({ status: 'missing', evidence: [] }),
  N14: (r) => {
    const fromFile = checkAny(r, ['knip.json', 'scripts/check-no-unused-exports.mjs'])
    if (fromFile.status === 'present') return fromFile
    const pkg = readPkgJson(r)
    if (hasDep(pkg, 'knip')) return { status: 'present', evidence: ['package.json'] }
    return { status: 'missing', evidence: [] }
  },
  N15: (r) => {
    const fromFile = checkAny(r, ['.jscpd.json'])
    if (fromFile.status === 'present') return fromFile
    const pkg = readPkgJson(r)
    if (hasDep(pkg, 'jscpd')) return { status: 'present', evidence: ['package.json'] }
    return { status: 'missing', evidence: [] }
  },
  N16: (r) =>
    checkAny(r, [
      'src/tokens',
      'design-tokens.json',
      'tailwind.config.js',
      'tailwind.config.ts',
      'tailwind.config.cjs',
      'tailwind.config.mjs',
    ]),

  // ── test_framework ────────────────────────────────────────────────────────
  N17: (r) =>
    checkAny(r, [
      'vitest.config.ts',
      'vitest.config.js',
      'vitest.config.mjs',
      'vitest.config.cjs',
      'jest.config.ts',
      'jest.config.js',
      'jest.config.cjs',
      'jest.config.mjs',
      'pytest.ini',
      'setup.cfg',
      'Cargo.toml',
    ]),
  N18: (r) => {
    const candidates = [
      'vitest.config.ts',
      'vitest.config.js',
      'vitest.config.mjs',
      '.nycrc',
      '.nycrc.json',
    ]
    const found: string[] = []
    for (const rel of candidates) {
      const abs = join(r, rel)
      if (
        existsSync(abs) &&
        fileContains(abs, /thresholds|coverage.*lines|branches|statements|functions/)
      ) {
        found.push(rel)
      }
    }
    // jacoco in build.gradle
    if (fileContains(join(r, 'build.gradle'), 'jacoco')) found.push('build.gradle')
    if (found.length === 0) return { status: 'missing', evidence: [] }
    return { status: 'present', evidence: found.slice(0, EVIDENCE_CAP) }
  },
  N19: (r) => checkAny(r, ['scripts/coverage-baseline.json', '.coverage-baseline']),
  N20: (r) => {
    const fromFile = checkAny(r, [
      'stryker.config.js',
      'stryker.config.ts',
      'stryker.config.mjs',
      'stryker.config.cjs',
      'stryker.config.json',
      'stryker.conf.json',
      '.mutmut.toml',
    ])
    if (fromFile.status === 'present') return fromFile
    const pkg = readPkgJson(r)
    if (hasDep(pkg, '@stryker-mutator/core') || hasDep(pkg, 'stryker')) {
      return { status: 'present', evidence: ['package.json'] }
    }
    if (
      fileContains(join(r, 'pom.xml'), 'pitest') ||
      fileContains(join(r, 'build.gradle'), 'pitest')
    ) {
      const src = fileContains(join(r, 'pom.xml'), 'pitest') ? 'pom.xml' : 'build.gradle'
      return { status: 'present', evidence: [src] }
    }
    return { status: 'missing', evidence: [] }
  },
  N21: (r) => {
    const candidates = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs']
    for (const rel of candidates) {
      const abs = join(r, rel)
      if (existsSync(abs) && fileContains(abs, /pool|poolOptions|threads|forks/)) {
        return { status: 'present', evidence: [rel] }
      }
    }
    return { status: 'missing', evidence: [] }
  },
  N22: (r) => checkAny(r, ['scripts/check-test-naming.mjs']),
  N23: (r) => checkDir(r, '.arbiter/evidence/tdd'),

  // ── test_profiles ─────────────────────────────────────────────────────────
  N24: (r) => {
    const pkg = readPkgJson(r)
    if (hasScript(pkg, 'test:unit')) return { status: 'present', evidence: ['package.json'] }
    // partial: vitest config with exclude/testPathIgnorePatterns → unit-only heuristic
    const vitestCandidates = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs']
    for (const rel of vitestCandidates) {
      const abs = join(r, rel)
      if (existsSync(abs) && fileContains(abs, /exclude|testPathIgnorePatterns/)) {
        return { status: 'partial', evidence: [rel] }
      }
    }
    return { status: 'missing', evidence: [] }
  },
  N25: (r) => {
    const pkg = readPkgJson(r)
    if (hasScript(pkg, 'test:integration')) return { status: 'present', evidence: ['package.json'] }
    const wfs = workflowsMatchingPattern(r, 'integration')
    if (wfs.length > 0) return { status: 'partial', evidence: wfs.slice(0, EVIDENCE_CAP) }
    return { status: 'missing', evidence: [] }
  },
  N26: (r) => {
    const wfs = workflowsMatchingPattern(r, 'schedule:')
    if (wfs.length === 0) return { status: 'missing', evidence: [] }
    return { status: 'present', evidence: wfs.slice(0, EVIDENCE_CAP) }
  },

  // ── test_types ────────────────────────────────────────────────────────────
  N27: (r) => {
    const fromDir = checkDir(r, '__tests__/integration')
    if (fromDir.status === 'present') return fromDir
    const javaTests = findRecursive(join(r, 'src', 'test'), (n) => n.endsWith('IT.java')).map((a) =>
      toPosixRelative(r, a),
    )
    if (javaTests.length > 0)
      return { status: 'present', evidence: javaTests.slice(0, EVIDENCE_CAP) }
    return { status: 'missing', evidence: [] }
  },
  N28: (r) => {
    const fromDir = checkDir(r, '__tests__/contract')
    if (fromDir.status === 'present') return fromDir
    const pkg = readPkgJson(r)
    if (hasDep(pkg, '@pact-foundation/pact') || hasDep(pkg, 'pact')) {
      return { status: 'present', evidence: ['package.json'] }
    }
    if (
      fileContains(join(r, 'pom.xml'), 'spring-cloud-contract') ||
      fileContains(join(r, 'build.gradle'), 'spring-cloud-contract')
    ) {
      const src = fileContains(join(r, 'pom.xml'), 'spring-cloud-contract')
        ? 'pom.xml'
        : 'build.gradle'
      return { status: 'present', evidence: [src] }
    }
    return { status: 'missing', evidence: [] }
  },
  N29: (r) => {
    const fromBehavioral = checkDir(r, '__tests__/behavioral')
    if (fromBehavioral.status === 'present') return fromBehavioral
    const fromFeatures = checkDir(r, 'features')
    if (fromFeatures.status === 'present') return fromFeatures
    const pkg = readPkgJson(r)
    if (hasDep(pkg, '@cucumber/cucumber') || hasDep(pkg, 'cucumber') || hasDep(pkg, 'pytest-bdd')) {
      return { status: 'present', evidence: ['package.json'] }
    }
    return { status: 'missing', evidence: [] }
  },
  N30: (r) => {
    const depFiles = hasArchUnitDep(r)
    if (depFiles.length === 0) return { status: 'missing', evidence: [] }
    const testClasses = findArchTestClasses(r)
    if (testClasses.length > 0) {
      return { status: 'present', evidence: [...depFiles, ...testClasses].slice(0, EVIDENCE_CAP) }
    }
    return { status: 'missing', evidence: [] }
  },
  N31: (r) => {
    const fromDir = checkDir(r, 'fuzz')
    if (fromDir.status === 'present') return fromDir
    const fuzzFiles = findRecursive(join(r, 'src', 'test'), (n) => /Fuzz/i.test(n)).map((a) =>
      toPosixRelative(r, a),
    )
    if (fuzzFiles.length > 0)
      return { status: 'present', evidence: fuzzFiles.slice(0, EVIDENCE_CAP) }
    return { status: 'missing', evidence: [] }
  },
  N32: (r) => {
    const pkg = readPkgJson(r)
    if (hasDep(pkg, 'fast-check') || hasDep(pkg, 'hypothesis') || hasDep(pkg, 'proptest')) {
      return { status: 'present', evidence: ['package.json'] }
    }
    return { status: 'missing', evidence: [] }
  },
  N33: (r) => {
    const fromSnapshots = checkDir(r, '__tests__/__snapshots__')
    if (fromSnapshots.status === 'present') return fromSnapshots
    const fromSrcSnapshots = checkDir(r, 'src/__snapshots__')
    if (fromSrcSnapshots.status === 'present') return fromSrcSnapshots
    return checkAny(r, ['scripts/check-api-snapshot.mjs'])
  },

  // ── cicd ──────────────────────────────────────────────────────────────────
  N34: (r) => {
    const workflows = globWorkflows(r)
    if (workflows.length < 2) return { status: 'missing', evidence: [] }
    return { status: 'present', evidence: workflows.slice(0, EVIDENCE_CAP) }
  },
  N35: (r) => {
    const wfs = workflowsMatchingPattern(r, 'pull_request')
    if (wfs.length === 0) return { status: 'missing', evidence: [] }
    return { status: 'present', evidence: wfs.slice(0, EVIDENCE_CAP) }
  },
  N36: (r) => {
    const wfs = workflowsMatchingPattern(r, /push[\s\S]*?tags|release:/)
    if (wfs.length === 0) return { status: 'missing', evidence: [] }
    return { status: 'present', evidence: wfs.slice(0, EVIDENCE_CAP) }
  },
  N37: (r) => {
    const wfs = workflowsMatchingPattern(r, 'schedule:')
    const matching = wfs.filter(
      (f) => /nightly/i.test(f) || fileContains(join(r, f), /cron:.*"0 [0-5]/),
    )
    if (matching.length === 0) return { status: 'missing', evidence: [] }
    return { status: 'present', evidence: matching.slice(0, EVIDENCE_CAP) }
  },
  N38: (r) => {
    const wfs = workflowsMatchingPattern(r, 'schedule:')
    const matching = wfs.filter(
      (f) => /weekly/i.test(f) || fileContains(join(r, f), /cron:.*"0 \d+ \* \* 0/),
    )
    if (matching.length === 0) return { status: 'missing', evidence: [] }
    return { status: 'present', evidence: matching.slice(0, EVIDENCE_CAP) }
  },
  N39: (r) => {
    const wfs = workflowsMatchingPattern(r, 'CI_BUILD_RUNNER_LABEL')
    if (wfs.length > 0) return { status: 'present', evidence: wfs.slice(0, EVIDENCE_CAP) }
    // partial: workflows exist but none reference CI_BUILD_RUNNER_LABEL
    const allWfs = globWorkflows(r)
    if (allWfs.length > 0) return { status: 'partial', evidence: allWfs.slice(0, EVIDENCE_CAP) }
    return { status: 'missing', evidence: [] }
  },
  N40: (r) => {
    const wfs = workflowsMatchingPattern(r, /attest-build-provenance|cosign/)
    if (wfs.length > 0) return { status: 'present', evidence: wfs.slice(0, EVIDENCE_CAP) }
    const pkg = readPkgJson(r)
    if (hasDep(pkg, 'cosign')) return { status: 'present', evidence: ['package.json'] }
    return { status: 'missing', evidence: [] }
  },

  // ── e2e_perf ──────────────────────────────────────────────────────────────
  N41: (r) =>
    checkAny(r, [
      'playwright.config.ts',
      'playwright.config.js',
      'playwright.config.mjs',
      '__tests__/e2e',
    ]),
  N42: (r) => checkAny(r, ['k6', 'locustfile.py', 'gatling/simulations']),
  N43: (r) => {
    const wfs = workflowsMatchingPattern(r, /zap-|nuclei/)
    if (wfs.length === 0) return { status: 'missing', evidence: [] }
    return { status: 'present', evidence: wfs.slice(0, EVIDENCE_CAP) }
  },
  N44: (r) => {
    const pkg = readPkgJson(r)
    if (hasDep(pkg, 'keycloak-js') || hasDep(pkg, 'keycloak-connect')) {
      return { status: 'present', evidence: ['package.json'] }
    }
    const testFiles = findRecursive(join(r, '__tests__'), (n) => /keycloak/i.test(n)).map((a) =>
      toPosixRelative(r, a),
    )
    if (testFiles.length > 0)
      return { status: 'present', evidence: testFiles.slice(0, EVIDENCE_CAP) }
    if (
      fileContains(join(r, 'pom.xml'), 'keycloak') ||
      fileContains(join(r, 'build.gradle'), 'keycloak')
    ) {
      const src = fileContains(join(r, 'pom.xml'), 'keycloak') ? 'pom.xml' : 'build.gradle'
      return { status: 'present', evidence: [src] }
    }
    return { status: 'missing', evidence: [] }
  },

  // ── scripts_validation ────────────────────────────────────────────────────
  N45: (r) => {
    const fromScript = checkAny(r, ['scripts/check-format.mjs', 'scripts/check-format.sh'])
    if (fromScript.status === 'present') return fromScript
    const pkg = readPkgJson(r)
    if (hasScript(pkg, 'format') || hasScript(pkg, 'lint:format') || hasScript(pkg, 'fmt')) {
      return { status: 'present', evidence: ['package.json'] }
    }
    return { status: 'missing', evidence: [] }
  },
  N46: (r) => checkAny(r, ['scripts/check-spdx-headers.mjs']),
  N47: (r) => checkAny(r, ['scripts/check-no-orphan-todo.mjs']),
  N48: (r) => checkAny(r, ['scripts/check-no-placeholders.mjs']),
  N49: (r) => checkAny(r, ['scripts/check-doc-links.mjs']),
  N50: (r) => checkAny(r, ['scripts/check-bloat-ratchet.mjs']),

  // ── scripts_quality ───────────────────────────────────────────────────────
  N51: (r) => checkAny(r, ['scripts/debt-report.mjs', 'debt-baseline.json']),
  N52: (r) => checkAny(r, ['scripts/check-self-dogfood.mjs']),
  N53: (r) => checkAny(r, ['scripts/check-api-snapshot.mjs', 'api-snapshot.json']),
  N54: (r) => {
    const fromScript = checkAny(r, ['scripts/check-circular-deps.mjs'])
    if (fromScript.status === 'present') return fromScript
    const pkg = readPkgJson(r)
    if (hasDep(pkg, 'madge')) return { status: 'present', evidence: ['package.json'] }
    return { status: 'missing', evidence: [] }
  },

  // ── security ──────────────────────────────────────────────────────────────
  N55: (r) => {
    const fromConfig = checkAny(r, ['.gitleaks.toml', '.gitleaks.config.toml'])
    if (fromConfig.status === 'present') return fromConfig
    const wfs = workflowsMatchingPattern(r, 'gitleaks')
    if (wfs.length > 0) return { status: 'partial', evidence: wfs.slice(0, EVIDENCE_CAP) }
    return { status: 'missing', evidence: [] }
  },
  N56: (r) => {
    const fromConfig = checkAny(r, ['owasp-suppressions.xml', '.audit-ci.json'])
    if (fromConfig.status === 'present') return fromConfig
    const wfs = workflowsMatchingPattern(r, 'npm audit')
    if (wfs.length > 0) return { status: 'partial', evidence: wfs.slice(0, EVIDENCE_CAP) }
    return { status: 'missing', evidence: [] }
  },
  N57: (r) => {
    const fromConfig = checkAny(r, ['.trivyignore'])
    if (fromConfig.status === 'present') return fromConfig
    const wfs = workflowsMatchingPattern(r, /trivy|aquasecurity/)
    if (wfs.length > 0) return { status: 'present', evidence: wfs.slice(0, EVIDENCE_CAP) }
    return { status: 'missing', evidence: [] }
  },
  N58: (r) => {
    const fromFile = checkAny(r, ['.fossa.yml', '.fossa.yaml'])
    if (fromFile.status === 'present') return fromFile
    const pkg = readPkgJson(r)
    if (hasDep(pkg, 'licensee')) return { status: 'present', evidence: ['package.json'] }
    return { status: 'missing', evidence: [] }
  },

  // ── git_github ────────────────────────────────────────────────────────────
  N59: (r) =>
    checkAny(r, [
      'commitlint.config.js',
      'commitlint.config.ts',
      'commitlint.config.cjs',
      'commitlint.config.mjs',
      '.commitlintrc',
      '.commitlintrc.js',
      '.commitlintrc.json',
      '.commitlintrc.yml',
      '.commitlintrc.yaml',
    ]),
  N60: (r) => {
    const fromScript = checkAny(r, ['scripts/check-branch-name.mjs'])
    if (fromScript.status === 'present') return fromScript
    if (fileContains(join(r, 'AGENTS.md'), /branch.*convention|branch.*format|branch.*pattern/i)) {
      return { status: 'partial', evidence: ['AGENTS.md'] }
    }
    return { status: 'missing', evidence: [] }
  },
  N61: (r) => checkAny(r, ['.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md']),
  N62: (r) => checkDir(r, '.github/ISSUE_TEMPLATE'),

  // ── documentation ─────────────────────────────────────────────────────────
  N63: (r) => checkAny(r, ['AGENTS.md', '.claude/CLAUDE.md']),
  N64: (r) =>
    checkAny(r, [
      'docs/REFERENCE/ci-developer-reference.md',
      'docs/ci-reference.md',
      'docs/ci-developer-reference.md',
    ]),
  N65: (r) => {
    // Check both cases: generated target projects use docs/adr/ (lowercase);
    // arbiter self uses docs/ADR/ (uppercase). DECISIONS.md as legacy fallback.
    const fromDirLower = checkDir(r, 'docs/adr')
    if (fromDirLower.status === 'present') return fromDirLower
    const fromDirUpper = checkDir(r, 'docs/ADR')
    if (fromDirUpper.status === 'present') return fromDirUpper
    return checkAny(r, ['docs/SYSTEM/DECISIONS.md'])
  },
  N66: (r) =>
    checkAny(r, [
      'openapi.yaml',
      'openapi.json',
      'swagger.yaml',
      'swagger.json',
      'api-spec.yaml',
      'api-spec.json',
    ]),
  N67: (r) => {
    const fromDir = checkDir(r, 'docs/runbooks')
    if (fromDir.status === 'present') return fromDir
    return checkAny(r, ['RUNBOOK.md', 'docs/runbook.md', 'docs/RUNBOOK.md'])
  },
  N68: (r) => checkAny(r, ['docs/METHOD/KNOWLEDGE_MAP.md', 'scripts/check-knowledge-map.mjs']),

  // ── configuration ─────────────────────────────────────────────────────────
  N69: (r) => checkAny(r, ['.nvmrc', '.node-version', '.tool-versions']),
  N70: (r) => {
    const abs = join(r, '.env.example')
    if (existsSync(abs)) return { status: 'present', evidence: ['.env.example'] }
    // glob .env*.example
    let entries: string[]
    try {
      entries = readdirSync(r)
    } catch {
      return { status: 'missing', evidence: [] }
    }
    const found = entries.filter((f) => f.startsWith('.env') && f.includes('example'))
    if (found.length > 0) return { status: 'present', evidence: found.slice(0, EVIDENCE_CAP) }
    return { status: 'missing', evidence: [] }
  },
  N71: (r) => checkAny(r, ['src/experimental/registry.ts', 'src/feature-flags.ts']),
  N72: (r) =>
    checkAny(r, [
      'docker-compose.staging.yml',
      'docker-compose.staging.yaml',
      'config/dev',
      'config/prod',
    ]),

  // ── a11y ──────────────────────────────────────────────────────────────────
  N76: (r) => {
    const pkg = readPkgJson(r)
    if (
      hasDep(pkg, 'axe-core') ||
      hasDep(pkg, '@axe-core/playwright') ||
      hasDep(pkg, 'pa11y') ||
      hasDep(pkg, 'pa11y-ci')
    ) {
      return { status: 'present', evidence: ['package.json'] }
    }
    return checkAny(r, ['.lighthouserc.js', '.lighthouserc.json', '.lighthouserc.yml'])
  },

  // ── module_boundaries ─────────────────────────────────────────────────────
  N77: (r) => {
    const hasPomDep =
      fileContains(join(r, 'pom.xml'), 'spring-modulith') ||
      fileContains(join(r, 'build.gradle'), 'spring-modulith')
    if (!hasPomDep) return { status: 'missing', evidence: [] }
    const src = fileContains(join(r, 'pom.xml'), 'spring-modulith') ? 'pom.xml' : 'build.gradle'
    // Check for ApplicationModules.verify() usage in test sources
    const verifyFiles = findRecursive(join(r, 'src', 'test'), (n) => n.endsWith('.java')).filter(
      (abs) => fileContains(abs, 'ApplicationModules'),
    )
    if (verifyFiles.length > 0) {
      return {
        status: 'present',
        evidence: [src, ...verifyFiles.map((a) => toPosixRelative(r, a))].slice(0, EVIDENCE_CAP),
      }
    }
    return { status: 'present', evidence: [src] }
  },
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function measureDim(dim: KitDimension, repoRoot: string): MeasureResult {
  if (!existsSync(repoRoot)) return { status: 'missing', evidence: [] }

  try {
    const handler = DIM_HANDLERS[dim.id]
    if (!handler) return { status: 'missing', evidence: [] }
    const raw = handler(repoRoot)
    const evidence = Array.from(new Set(raw.evidence)).sort()
    return { status: raw.status, evidence }
  } catch (err) {
    diagnosticErrors++
    process.stderr.write(`[measure] measureDim failed for ${dim.id}: ${String(err)}\n`)
    return { status: 'missing', evidence: [] }
  }
}

export function getMeasureDiagnosticErrors(): number {
  return diagnosticErrors
}
