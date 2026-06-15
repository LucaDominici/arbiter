// SPDX-License-Identifier: Apache-2.0
// conformance/dimensions.ts — per-dimension probe functions for `arbiter conformance` (#1369).
//
// Each probe function receives the resolved project root and returns a DimensionEntry.
// Pure functions: no process.exit, no console. All IO is wrapped in try/catch for
// fail-safe operation (RT-02: IO errors must not crash the command).

import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Verdict, Evidence } from './engine.js'
import { safeResolve, readJson, fileExists } from './shared.js'

export type DimensionVerdict = Verdict
export type { Verdict, Evidence }

export interface DimensionEntry {
  id: string
  title: string
  /** Quality family for two-tier scoring. */
  family: 'discipline' | 'reality-contact' | 'docs-convention' | 'code-quality-gold'
  /** 1 = must-pass gate; 2 = weighted contributor. */
  tier: 1 | 2
  /** Tier-2 weight within its family (0 for tier-1 gates). */
  weight: number
  /** Minimum governance level at which this dimension is required. */
  required_at: string
  verdict: DimensionVerdict
  evidence: string | Evidence
  detail?: string
}

/** Shared field values for all reality-contact tier-1 dimensions. */
const RC_T1: Pick<DimensionEntry, 'family' | 'tier' | 'weight' | 'required_at'> = {
  family: 'reality-contact',
  tier: 1,
  weight: 0,
  required_at: 'L1',
}

/** Walk directory recursively, returning all file paths (relative to root). */
function walkFiles(dir: string, root: string, skipDirs: Set<string>): string[] {
  const results: string[] = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return results
  }
  for (const entry of entries) {
    if (skipDirs.has(entry)) continue
    const abs = join(dir, entry)
    try {
      const st = statSync(abs)
      if (st.isDirectory()) {
        results.push(...walkFiles(abs, root, skipDirs))
      } else {
        results.push(relative(root, abs))
      }
    } catch {
      // skip unreadable entries
    }
  }
  return results
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.coverage'])

/** Simple glob match supporting * and ** (same logic as check-test-pyramid.mjs). */
function globMatch(pattern: string, filepath: string): boolean {
  let reStr = '^'
  let i = 0
  while (i < pattern.length) {
    const ch: string = pattern[i] ?? ''
    if (ch === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        reStr += '(?:[^/]*/)*'
        i += 3
      } else {
        reStr += '[\\s\\S]*'
        i += 2
      }
    } else if (ch === '*') {
      reStr += '[^/]*'
      i++
    } else if ('\\.+?^${}()|[]'.includes(ch)) {
      reStr += '\\' + ch
      i++
    } else {
      reStr += ch
      i++
    }
  }
  reStr += '$'
  return new RegExp(reStr).test(filepath)
}

// ─── D-TEST-LEVELS ────────────────────────────────────────────────────────────

const D_TEST_LEVELS_ID = 'D-TEST-LEVELS'
const D_TEST_LEVELS_TITLE = 'Declared test levels populated'

/** Check a single required pyramid level; returns the level name if empty, null if populated. */
function checkRequiredLevel(lvl: unknown, allFiles: string[]): string | null {
  if (typeof lvl !== 'object' || lvl === null) return null
  const l = lvl as Record<string, unknown>
  const status = typeof l['status'] === 'string' ? l['status'] : 'required'
  if (status !== 'required') return null
  const globs = Array.isArray(l['globs']) ? (l['globs'] as string[]) : []
  const matched = globs.some((g) => allFiles.some((f) => globMatch(g, f)))
  const levelName = typeof l['level'] === 'string' ? l['level'] : 'unknown'
  return matched ? null : levelName
}

/**
 * D-TEST-LEVELS: Declared test levels are populated (test-pyramid.json present +
 * all required levels have ≥1 matching test file).
 */
export function probeDTestLevels(root: string): DimensionEntry {
  const pyramidPath = safeResolve(root, 'test-pyramid.json')
  if (pyramidPath === null || !fileExists(pyramidPath)) {
    return {
      id: D_TEST_LEVELS_ID,
      title: D_TEST_LEVELS_TITLE,
      ...RC_T1,
      verdict: 'N',
      evidence: 'test-pyramid.json missing — no test pyramid declared',
    }
  }

  const manifest = readJson(pyramidPath)
  if (manifest === null || typeof manifest !== 'object') {
    return {
      id: D_TEST_LEVELS_ID,
      title: D_TEST_LEVELS_TITLE,
      ...RC_T1,
      verdict: 'N',
      evidence: 'test-pyramid.json: parse error',
    }
  }

  const m = manifest as Record<string, unknown>
  const levels = Array.isArray(m['levels']) ? (m['levels'] as unknown[]) : []

  if (levels.length === 0) {
    return {
      id: D_TEST_LEVELS_ID,
      title: D_TEST_LEVELS_TITLE,
      ...RC_T1,
      verdict: 'N',
      evidence: 'test-pyramid.json: no levels declared',
    }
  }

  const allFiles = walkFiles(root, root, SKIP_DIRS)
  const failures = levels
    .map((lvl) => checkRequiredLevel(lvl, allFiles))
    .filter((r): r is string => r !== null)

  if (failures.length > 0) {
    return {
      id: D_TEST_LEVELS_ID,
      title: D_TEST_LEVELS_TITLE,
      ...RC_T1,
      verdict: 'N',
      evidence: `test-pyramid.json: empty required levels: ${failures.join(', ')}`,
    }
  }

  return {
    id: D_TEST_LEVELS_ID,
    title: D_TEST_LEVELS_TITLE,
    ...RC_T1,
    verdict: 'Y',
    evidence: 'test-pyramid.json: all required levels populated',
  }
}

// ─── D-LIVE-E2E ───────────────────────────────────────────────────────────────

/** Patterns considered e2e test files. */
const E2E_PATTERNS = ['**/*.e2e.ts', '**/*.e2e.js', '**/e2e/**/*.ts', '**/e2e/**/*.js']

/**
 * D-LIVE-E2E: A non-mocked live API e2e layer exists and runs.
 * Evidence: e2e test files present in the repo tree.
 */
export function probeDLiveE2e(root: string): DimensionEntry {
  const allFiles = walkFiles(root, root, SKIP_DIRS)
  const found = allFiles.filter((f) => E2E_PATTERNS.some((p) => globMatch(p, f)))

  if (found.length > 0) {
    return {
      id: 'D-LIVE-E2E',
      title: 'Non-mocked live API e2e layer exists and runs',
      ...RC_T1,
      verdict: 'Y',
      evidence: `${found.length} e2e file(s) found: ${found[0]}${found.length > 1 ? ` (+${found.length - 1} more)` : ''}`,
    }
  }

  return {
    id: 'D-LIVE-E2E',
    title: 'Non-mocked live API e2e layer exists and runs',
    ...RC_T1,
    verdict: 'N',
    evidence: 'no e2e test files found (patterns: *.e2e.ts, e2e/**/*.ts)',
  }
}

// ─── D-FE-RENDER-GATE ─────────────────────────────────────────────────────────

const D_FE_RENDER_GATE_ID = 'D-FE-RENDER-GATE'
const D_FE_RENDER_GATE_TITLE = 'FE archetypes have behavioural/visual gate'

const FE_ARCHETYPES = new Set([
  'frontend',
  'frontend-web',
  'frontend-spa',
  'fullstack',
  'fullstack-web',
])

const FE_RENDER_EVIDENCE_FILES = [
  'playwright.config.ts',
  'playwright.config.js',
  'vitest.browser.config.ts',
  'vitest.browser.config.js',
  'chromatic.config.ts',
  'chromatic.config.js',
]

/**
 * D-FE-RENDER-GATE: FE archetypes have a behavioural/visual gate.
 * NA when archetype is not a frontend type.
 */
export function probeDFeRenderGate(root: string, archetype: string | null): DimensionEntry {
  const isFe =
    archetype !== null &&
    (FE_ARCHETYPES.has(archetype) || archetype.startsWith('frontend') || archetype === 'fullstack')

  if (!isFe) {
    return {
      id: D_FE_RENDER_GATE_ID,
      title: D_FE_RENDER_GATE_TITLE,
      ...RC_T1,
      verdict: 'NA',
      evidence: `archetype "${archetype ?? 'unset'}" is not a frontend type — not applicable`,
    }
  }

  for (const file of FE_RENDER_EVIDENCE_FILES) {
    const abs = safeResolve(root, file)
    if (abs !== null && fileExists(abs)) {
      return {
        id: D_FE_RENDER_GATE_ID,
        title: D_FE_RENDER_GATE_TITLE,
        ...RC_T1,
        verdict: 'Y',
        evidence: file,
      }
    }
  }

  return {
    id: D_FE_RENDER_GATE_ID,
    title: D_FE_RENDER_GATE_TITLE,
    ...RC_T1,
    verdict: 'N',
    evidence: 'no playwright/vitest-browser/chromatic config found for frontend archetype',
  }
}

// ─── D-DOMAIN-API ─────────────────────────────────────────────────────────────

const DOMAIN_API_EVIDENCE_FILES = [
  'openapi.yaml',
  'openapi.yml',
  'openapi.json',
  'api/openapi.yaml',
  'api/openapi.yml',
  'api/openapi.json',
  'pact.config.ts',
  'pact.config.js',
  '.pact',
]

/**
 * D-DOMAIN-API: domain↔API surface completeness is checked.
 * Evidence: OpenAPI spec file or Pact config found in the project.
 */
export function probeDDomainApi(root: string): DimensionEntry {
  for (const file of DOMAIN_API_EVIDENCE_FILES) {
    const abs = safeResolve(root, file)
    if (abs !== null && fileExists(abs)) {
      return {
        id: 'D-DOMAIN-API',
        title: 'Domain↔API surface completeness checked',
        ...RC_T1,
        verdict: 'Y',
        evidence: file,
      }
    }
  }

  return {
    id: 'D-DOMAIN-API',
    title: 'Domain↔API surface completeness checked',
    ...RC_T1,
    verdict: 'N',
    evidence: 'no openapi spec or pact config found (check openapi.yaml, pact.config.ts, .pact)',
  }
}

// ─── D-DONE-EVIDENCE ─────────────────────────────────────────────────────────

const D_DONE_EVIDENCE_ID = 'D-DONE-EVIDENCE'
const D_DONE_EVIDENCE_TITLE = 'Done-evidence requires reality-contact'

/**
 * D-DONE-EVIDENCE: done-evidence requires reality-contact.
 * Evidence: .arbiter/evidence/ directory exists and contains evidence files.
 */
export function probeDDoneEvidence(root: string): DimensionEntry {
  const evidenceDir = safeResolve(root, '.arbiter/evidence')
  if (evidenceDir === null || !fileExists(evidenceDir)) {
    return {
      id: D_DONE_EVIDENCE_ID,
      title: D_DONE_EVIDENCE_TITLE,
      ...RC_T1,
      verdict: 'N',
      evidence: '.arbiter/evidence/ absent — no evidence harness active',
    }
  }

  // Count evidence files (json files recursively)
  const allFiles = walkFiles(evidenceDir, root, new Set(['.git']))
  const evidenceFiles = allFiles.filter((f) => f.endsWith('.json'))

  if (evidenceFiles.length === 0) {
    return {
      id: D_DONE_EVIDENCE_ID,
      title: D_DONE_EVIDENCE_TITLE,
      ...RC_T1,
      verdict: 'P',
      evidence: '.arbiter/evidence/ exists but is empty — no evidence files recorded',
    }
  }

  return {
    id: 'D-DONE-EVIDENCE',
    title: 'Done-evidence requires reality-contact',
    ...RC_T1,
    verdict: 'Y',
    evidence: `.arbiter/evidence/: ${evidenceFiles.length} evidence file(s) found`,
  }
}
