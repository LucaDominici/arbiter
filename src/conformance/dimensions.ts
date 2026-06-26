// SPDX-License-Identifier: Apache-2.0
// conformance/dimensions.ts — per-dimension probe functions for `arbiter conformance` (#1369).
//
// Each probe function receives the resolved project root and returns a DimensionEntry.
// Pure functions: no process.exit, no console. All IO is wrapped in try/catch for
// fail-safe operation (RT-02: IO errors must not crash the command).
//
// C3 (#1395): probes rewritten to read canonical manifests; evidence narrowed to Evidence.

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Verdict, Evidence } from './engine.js'
import { safeResolve, readJson, readText, fileExists, globMatch, walkRepo } from './shared.js'

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
  evidence: Evidence
}

/** Shared field values for all reality-contact tier-1 dimensions. */
const RC_T1: Pick<DimensionEntry, 'family' | 'tier' | 'weight' | 'required_at'> = {
  family: 'reality-contact',
  tier: 1,
  weight: 0,
  required_at: 'L1',
}

/** Shared field values for all discipline tier-1 dimensions. */
const DISC_T1: Pick<DimensionEntry, 'family' | 'tier' | 'weight' | 'required_at'> = {
  family: 'discipline',
  tier: 1,
  weight: 0,
  required_at: 'L1',
}

// --- D-TEST-LEVELS ---

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
 * all required levels have at least 1 matching test file).
 * Reads test-pyramid.json as the canonical manifest.
 */
export function probeDTestLevels(root: string): DimensionEntry {
  const pyramidPath = safeResolve(root, 'test-pyramid.json')
  if (pyramidPath === null || !fileExists(pyramidPath)) {
    return {
      id: D_TEST_LEVELS_ID,
      title: D_TEST_LEVELS_TITLE,
      ...RC_T1,
      verdict: 'N',
      evidence: { file: 'test-pyramid.json', detail: 'missing — no test pyramid declared' },
    }
  }

  const manifest = readJson(pyramidPath)
  if (manifest === null || typeof manifest !== 'object') {
    return {
      id: D_TEST_LEVELS_ID,
      title: D_TEST_LEVELS_TITLE,
      ...RC_T1,
      verdict: 'N',
      evidence: { file: 'test-pyramid.json', detail: 'parse error' },
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
      evidence: { file: 'test-pyramid.json', detail: 'no levels declared' },
    }
  }

  // Route through the shared, cycle-safe walker (lstat skip-symlink + dev:ino visited guard).
  // A target repo with a directory symlink cycle previously infinite-recursed / OOMed here. #1521.
  const allFiles = walkRepo(root)
  const failures = levels
    .map((lvl) => checkRequiredLevel(lvl, allFiles))
    .filter((r): r is string => r !== null)

  if (failures.length > 0) {
    return {
      id: D_TEST_LEVELS_ID,
      title: D_TEST_LEVELS_TITLE,
      ...RC_T1,
      verdict: 'N',
      evidence: {
        file: 'test-pyramid.json',
        detail: `empty required levels: ${failures.join(', ')}`,
      },
    }
  }

  return {
    id: D_TEST_LEVELS_ID,
    title: D_TEST_LEVELS_TITLE,
    ...RC_T1,
    verdict: 'Y',
    evidence: { file: 'test-pyramid.json', detail: 'all required levels populated' },
  }
}

// --- D-LIVE-E2E ---

/** Archetypes that are considered service/backend types requiring e2e. */
const SERVICE_ARCHETYPES = new Set([
  'backend',
  'backend-web-db',
  'backend-api',
  'backend-service',
  'service',
  'fullstack',
  'fullstack-web',
])

/**
 * D-LIVE-E2E: A non-mocked live API e2e layer exists and runs.
 * Reads api-e2e.json as the canonical manifest. NA for non-service archetypes.
 */
export function probeDLiveE2e(root: string, archetype: string | null): DimensionEntry {
  const isService =
    archetype !== null &&
    (SERVICE_ARCHETYPES.has(archetype) ||
      archetype.startsWith('backend') ||
      archetype === 'fullstack')

  if (!isService) {
    return {
      id: 'D-LIVE-E2E',
      title: 'Non-mocked live API e2e layer exists and runs',
      ...RC_T1,
      verdict: 'NA',
      evidence: {
        file: 'arbiter.json',
        detail: `archetype "${archetype ?? 'unset'}" is not a service type — not applicable`,
      },
    }
  }

  const manifestPath = safeResolve(root, 'api-e2e.json')
  if (manifestPath === null || !fileExists(manifestPath)) {
    return {
      id: 'D-LIVE-E2E',
      title: 'Non-mocked live API e2e layer exists and runs',
      ...RC_T1,
      verdict: 'N',
      evidence: { file: 'api-e2e.json', detail: 'missing — no e2e manifest declared' },
    }
  }

  const manifest = readJson(manifestPath)
  if (manifest === null || typeof manifest !== 'object') {
    return {
      id: 'D-LIVE-E2E',
      title: 'Non-mocked live API e2e layer exists and runs',
      ...RC_T1,
      verdict: 'N',
      evidence: { file: 'api-e2e.json', detail: 'parse error' },
    }
  }

  const m = manifest as Record<string, unknown>
  const suiteCount = typeof m['suiteCount'] === 'number' ? m['suiteCount'] : 0

  if (suiteCount > 0) {
    return {
      id: 'D-LIVE-E2E',
      title: 'Non-mocked live API e2e layer exists and runs',
      ...RC_T1,
      verdict: 'Y',
      evidence: { file: 'api-e2e.json', detail: `suiteCount=${suiteCount}` },
    }
  }

  return {
    id: 'D-LIVE-E2E',
    title: 'Non-mocked live API e2e layer exists and runs',
    ...RC_T1,
    verdict: 'N',
    evidence: { file: 'api-e2e.json', detail: 'suiteCount=0 — no e2e suites registered' },
  }
}

// --- D-FE-RENDER-GATE ---

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
 * Reads render-smoke spec config files as evidence.
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
      evidence: {
        file: 'arbiter.json',
        detail: `archetype "${archetype ?? 'unset'}" is not a frontend type — not applicable`,
      },
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
        evidence: { file },
      }
    }
  }

  return {
    id: D_FE_RENDER_GATE_ID,
    title: D_FE_RENDER_GATE_TITLE,
    ...RC_T1,
    verdict: 'N',
    evidence: {
      file: 'arbiter.json',
      detail: 'no playwright/vitest-browser/chromatic config found for frontend archetype',
    },
  }
}

// --- D-DOMAIN-API ---

/**
 * D-DOMAIN-API: domain-API surface completeness is checked.
 * Reads domain-api-surface.json as the canonical manifest (checks array non-empty = Y).
 * Falls back to openapi.yaml / pact.config presence if manifest is absent.
 */
export function probeDDomainApi(root: string): DimensionEntry {
  const manifestPath = safeResolve(root, 'domain-api-surface.json')
  if (manifestPath !== null && fileExists(manifestPath)) {
    const manifest = readJson(manifestPath)
    if (manifest !== null && typeof manifest === 'object') {
      const m = manifest as Record<string, unknown>
      const checks = Array.isArray(m['checks']) ? m['checks'] : []
      if (checks.length > 0) {
        return {
          id: 'D-DOMAIN-API',
          title: 'Domain-API surface completeness checked',
          ...RC_T1,
          verdict: 'Y',
          evidence: {
            file: 'domain-api-surface.json',
            detail: `${checks.length} check(s) defined`,
          },
        }
      }
      return {
        id: 'D-DOMAIN-API',
        title: 'Domain-API surface completeness checked',
        ...RC_T1,
        verdict: 'N',
        evidence: { file: 'domain-api-surface.json', detail: 'checks array is empty' },
      }
    }
  }

  // Fallback: legacy openapi/pact presence
  const legacyFiles = [
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
  for (const file of legacyFiles) {
    const abs = safeResolve(root, file)
    if (abs !== null && fileExists(abs)) {
      return {
        id: 'D-DOMAIN-API',
        title: 'Domain-API surface completeness checked',
        ...RC_T1,
        verdict: 'Y',
        evidence: { file },
      }
    }
  }

  return {
    id: 'D-DOMAIN-API',
    title: 'Domain-API surface completeness checked',
    ...RC_T1,
    verdict: 'N',
    evidence: {
      file: 'domain-api-surface.json',
      detail: 'missing — no domain-api-surface.json or openapi/pact config found',
    },
  }
}

// --- D-DONE-EVIDENCE ---

const D_DONE_EVIDENCE_ID = 'D-DONE-EVIDENCE'
const D_DONE_EVIDENCE_TITLE = 'Done-evidence requires reality-contact'
const LAST_DONE_EVIDENCE_PATH = '.claude/.last-done-evidence.json'

/**
 * D-DONE-EVIDENCE: done-evidence requires reality-contact.
 * Reads .claude/.last-done-evidence.json; Y if reality_contact.passed=true.
 */
export function probeDDoneEvidence(root: string): DimensionEntry {
  const evidencePath = safeResolve(root, LAST_DONE_EVIDENCE_PATH)
  if (evidencePath === null || !fileExists(evidencePath)) {
    return {
      id: D_DONE_EVIDENCE_ID,
      title: D_DONE_EVIDENCE_TITLE,
      ...RC_T1,
      verdict: 'N',
      evidence: {
        file: LAST_DONE_EVIDENCE_PATH,
        detail: 'absent — no done-evidence recorded',
      },
    }
  }

  const manifest = readJson(evidencePath)
  if (manifest === null || typeof manifest !== 'object') {
    return {
      id: D_DONE_EVIDENCE_ID,
      title: D_DONE_EVIDENCE_TITLE,
      ...RC_T1,
      verdict: 'N',
      evidence: { file: LAST_DONE_EVIDENCE_PATH, detail: 'parse error' },
    }
  }

  const m = manifest as Record<string, unknown>
  const rc = m['reality_contact']
  if (typeof rc === 'object' && rc !== null && (rc as Record<string, unknown>)['passed'] === true) {
    return {
      id: D_DONE_EVIDENCE_ID,
      title: D_DONE_EVIDENCE_TITLE,
      ...RC_T1,
      verdict: 'Y',
      evidence: { file: LAST_DONE_EVIDENCE_PATH, detail: 'reality_contact.passed=true' },
    }
  }

  return {
    id: D_DONE_EVIDENCE_ID,
    title: D_DONE_EVIDENCE_TITLE,
    ...RC_T1,
    verdict: 'N',
    evidence: {
      file: LAST_DONE_EVIDENCE_PATH,
      detail: 'reality_contact.passed is not true',
    },
  }
}

// --- D-GATE-GREEN ---

const GATE_RESULT_PATH = '.arbiter/gate/local-result.json'

/**
 * D-GATE-GREEN: local gate most recently ran green.
 * Reads .arbiter/gate/local-result.json; Y if overall=pass.
 */
export function probeGateGreen(root: string): DimensionEntry {
  const resultPath = safeResolve(root, GATE_RESULT_PATH)
  if (resultPath === null || !fileExists(resultPath)) {
    return {
      id: 'D-GATE-GREEN',
      title: 'Local gate most recently ran green',
      ...DISC_T1,
      verdict: 'N',
      evidence: { file: GATE_RESULT_PATH, detail: 'absent — gate has not been run' },
    }
  }

  const manifest = readJson(resultPath)
  if (manifest !== null && typeof manifest === 'object') {
    const m = manifest as Record<string, unknown>
    if (m['overall'] === 'pass') {
      return {
        id: 'D-GATE-GREEN',
        title: 'Local gate most recently ran green',
        ...DISC_T1,
        verdict: 'Y',
        evidence: { file: GATE_RESULT_PATH, detail: 'overall=pass' },
      }
    }
  }

  return {
    id: 'D-GATE-GREEN',
    title: 'Local gate most recently ran green',
    ...DISC_T1,
    verdict: 'N',
    evidence: { file: GATE_RESULT_PATH, detail: 'overall is not pass' },
  }
}

// --- D-COVERAGE-THRESHOLDS ---

const COVERAGE_SUMMARY_PATH = 'coverage/coverage-summary.json'
const COVERAGE_THRESHOLD = 80

/**
 * D-COVERAGE-THRESHOLDS: all coverage metrics meet the 80% threshold.
 * Reads coverage/coverage-summary.json; NV if absent (not yet run).
 */
export function probeCoverageThresholds(root: string): DimensionEntry {
  const summaryPath = safeResolve(root, COVERAGE_SUMMARY_PATH)
  if (summaryPath === null || !fileExists(summaryPath)) {
    return {
      id: 'D-COVERAGE-THRESHOLDS',
      title: `All coverage metrics >= ${COVERAGE_THRESHOLD}%`,
      ...DISC_T1,
      verdict: 'NV',
      evidence: {
        file: COVERAGE_SUMMARY_PATH,
        detail: 'absent — coverage has not been collected',
      },
    }
  }

  const manifest = readJson(summaryPath)
  if (manifest === null || typeof manifest !== 'object') {
    return {
      id: 'D-COVERAGE-THRESHOLDS',
      title: `All coverage metrics >= ${COVERAGE_THRESHOLD}%`,
      ...DISC_T1,
      verdict: 'NV',
      evidence: { file: COVERAGE_SUMMARY_PATH, detail: 'parse error' },
    }
  }

  const m = manifest as Record<string, unknown>
  const total = m['total']
  if (typeof total !== 'object' || total === null) {
    return {
      id: 'D-COVERAGE-THRESHOLDS',
      title: `All coverage metrics >= ${COVERAGE_THRESHOLD}%`,
      ...DISC_T1,
      verdict: 'NV',
      evidence: { file: COVERAGE_SUMMARY_PATH, detail: 'total field missing' },
    }
  }

  const t = total as Record<string, unknown>
  const metrics = ['lines', 'branches', 'functions', 'statements'] as const
  const below: string[] = []
  for (const metric of metrics) {
    const entry = t[metric]
    if (typeof entry === 'object' && entry !== null) {
      const pct = (entry as Record<string, unknown>)['pct']
      if (typeof pct === 'number' && pct < COVERAGE_THRESHOLD) {
        below.push(`${metric}=${pct}%`)
      }
    }
  }

  if (below.length > 0) {
    return {
      id: 'D-COVERAGE-THRESHOLDS',
      title: `All coverage metrics >= ${COVERAGE_THRESHOLD}%`,
      ...DISC_T1,
      verdict: 'N',
      evidence: {
        file: COVERAGE_SUMMARY_PATH,
        detail: `below ${COVERAGE_THRESHOLD}%: ${below.join(', ')}`,
      },
    }
  }

  return {
    id: 'D-COVERAGE-THRESHOLDS',
    title: `All coverage metrics >= ${COVERAGE_THRESHOLD}%`,
    ...DISC_T1,
    verdict: 'Y',
    evidence: { file: COVERAGE_SUMMARY_PATH, detail: `all metrics >= ${COVERAGE_THRESHOLD}%` },
  }
}

// --- D-INVARIANTS-ENFORCED ---

const INVARIANTS_CATALOG_PATH = 'src/invariants/catalog.ts'

/**
 * D-INVARIANTS-ENFORCED: project has a machine-readable invariants catalog.
 * Evidence: src/invariants/catalog.ts exists (arbiter self-reference).
 * For generated projects: checks for .arbiter/invariants.json.
 */
export function probeInvariantsEnforced(root: string): DimensionEntry {
  const catalogPath = safeResolve(root, INVARIANTS_CATALOG_PATH)
  if (catalogPath !== null && fileExists(catalogPath)) {
    return {
      id: 'D-INVARIANTS-ENFORCED',
      title: 'Invariants catalog is machine-readable and enforced',
      ...DISC_T1,
      verdict: 'Y',
      evidence: { file: INVARIANTS_CATALOG_PATH },
    }
  }

  const arbiterInvPath = safeResolve(root, '.arbiter/invariants.json')
  if (arbiterInvPath !== null && fileExists(arbiterInvPath)) {
    return {
      id: 'D-INVARIANTS-ENFORCED',
      title: 'Invariants catalog is machine-readable and enforced',
      ...DISC_T1,
      verdict: 'Y',
      evidence: { file: '.arbiter/invariants.json' },
    }
  }

  return {
    id: 'D-INVARIANTS-ENFORCED',
    title: 'Invariants catalog is machine-readable and enforced',
    ...DISC_T1,
    verdict: 'NV',
    evidence: {
      file: INVARIANTS_CATALOG_PATH,
      detail: 'no invariants catalog found',
    },
  }
}

// --- D-NO-OVERCLAIM ---

/**
 * D-NO-OVERCLAIM: done-evidence explicitly asserts no overclaim.
 * Reads .claude/.last-done-evidence.json; Y if no_overclaim=true.
 */
export function probeNoOverclaim(root: string): DimensionEntry {
  const evidencePath = safeResolve(root, LAST_DONE_EVIDENCE_PATH)
  if (evidencePath === null || !fileExists(evidencePath)) {
    return {
      id: 'D-NO-OVERCLAIM',
      title: 'Done-evidence explicitly asserts no overclaim',
      ...DISC_T1,
      verdict: 'NV',
      evidence: {
        file: LAST_DONE_EVIDENCE_PATH,
        detail: 'absent — no done-evidence recorded',
      },
    }
  }

  const manifest = readJson(evidencePath)
  if (manifest !== null && typeof manifest === 'object') {
    const m = manifest as Record<string, unknown>
    if (m['no_overclaim'] === true) {
      return {
        id: 'D-NO-OVERCLAIM',
        title: 'Done-evidence explicitly asserts no overclaim',
        ...DISC_T1,
        verdict: 'Y',
        evidence: { file: LAST_DONE_EVIDENCE_PATH, detail: 'no_overclaim=true' },
      }
    }
  }

  return {
    id: 'D-NO-OVERCLAIM',
    title: 'Done-evidence explicitly asserts no overclaim',
    ...DISC_T1,
    verdict: 'N',
    evidence: {
      file: LAST_DONE_EVIDENCE_PATH,
      detail: 'no_overclaim is not true',
    },
  }
}

// --- D-COMMIT-HYGIENE ---

/**
 * D-COMMIT-HYGIENE: commit message hygiene enforced via Husky + commitlint.
 * Evidence: .husky/ directory and .commitlintrc.json both present.
 */
export function probeCommitHygiene(root: string): DimensionEntry {
  const huskyPath = safeResolve(root, '.husky')
  const commitlintPath = safeResolve(root, '.commitlintrc.json')

  const huskyExists = huskyPath !== null && fileExists(huskyPath)
  const commitlintExists = commitlintPath !== null && fileExists(commitlintPath)

  if (huskyExists && commitlintExists) {
    return {
      id: 'D-COMMIT-HYGIENE',
      title: 'Commit message hygiene enforced',
      ...DISC_T1,
      verdict: 'Y',
      evidence: { file: '.commitlintrc.json', detail: '.husky/ and .commitlintrc.json present' },
    }
  }

  const missing: string[] = []
  if (!huskyExists) missing.push('.husky/')
  if (!commitlintExists) missing.push('.commitlintrc.json')

  return {
    id: 'D-COMMIT-HYGIENE',
    title: 'Commit message hygiene enforced',
    ...DISC_T1,
    verdict: 'N',
    evidence: {
      file: '.commitlintrc.json',
      detail: `missing: ${missing.join(', ')}`,
    },
  }
}

// --- DISC-finding-hygiene (#1405) ---

const FINDING_HYGIENE_ID = 'DISC-finding-hygiene'
const FINDING_HYGIENE_TITLE = 'Incidental findings drained, not just filed'
const FINDINGS_DIR = '.arbiter/findings'
const FINDING_HYGIENE_BASELINE = '.arbiter/finding-hygiene-baseline.json'
/** Findings older than this many days are stale (un-promoted too long). */
const FINDING_STALE_DAYS = 14
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Aggregate of the un-promoted findings spool. */
interface SpoolStats {
  /** Distinct fingerprints across all shards (dedup-safe). */
  openCount: number
  /** Age in whole days of the OLDEST open finding (0 when empty). */
  oldestAgeDays: number
}

/** Mutable accumulator threaded through shard parsing. */
interface SpoolAccumulator {
  fingerprints: Set<string>
  oldestTs: number | null
}

/**
 * Fold a single spool shard's JSONL into the accumulator. Malformed lines are
 * skipped (resilient). The fingerprint dedups across shards; the timestamp tracks
 * the oldest open finding.
 */
function accumulateShard(text: string, acc: SpoolAccumulator): void {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let entry: unknown
    try {
      entry = JSON.parse(trimmed)
    } catch {
      continue // resilient: skip malformed JSONL
    }
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    const fp = typeof e['fingerprint'] === 'string' ? e['fingerprint'] : trimmed
    acc.fingerprints.add(fp)
    const ts = typeof e['ts'] === 'string' ? Date.parse(e['ts']) : NaN
    if (!Number.isNaN(ts) && (acc.oldestTs === null || ts < acc.oldestTs)) acc.oldestTs = ts
  }
}

/**
 * Read the findings spool. Returns null when the spool directory is absent
 * (→ NA: the project is not governed for findings). Fail-safe: malformed lines
 * and unreadable shards are skipped; an empty/absent spool yields count 0, age 0.
 */
function readFindingsSpool(root: string): SpoolStats | null {
  const dirAbs = safeResolve(root, FINDINGS_DIR)
  if (dirAbs === null || !fileExists(dirAbs)) return null
  let shards: string[]
  try {
    shards = readdirSync(dirAbs).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return { openCount: 0, oldestAgeDays: 0 }
  }
  const acc: SpoolAccumulator = { fingerprints: new Set<string>(), oldestTs: null }
  for (const shard of shards) {
    const text = readText(join(dirAbs, shard))
    if (text !== null) accumulateShard(text, acc)
  }
  const oldestAgeDays =
    acc.oldestTs === null ? 0 : Math.max(0, Math.floor((Date.now() - acc.oldestTs) / MS_PER_DAY))
  return { openCount: acc.fingerprints.size, oldestAgeDays }
}

/** Prior openFindingsCount snapshot, or null when no baseline exists (bootstrap). */
function readFindingHygienePrior(root: string): number | null {
  const abs = safeResolve(root, FINDING_HYGIENE_BASELINE)
  if (abs === null || !fileExists(abs)) return null
  const parsed = readJson(abs)
  if (parsed === null || typeof parsed !== 'object') return null
  const v = (parsed as Record<string, unknown>)['openFindingsCount']
  return typeof v === 'number' ? v : null
}

/**
 * DISC-finding-hygiene: rewards DRAINING the incidental-findings spool, never the
 * mere act of FILING findings (anti-gaming, INV-114). Evidence = the spool path.
 *
 * Verdict ladder:
 *   - spool absent                           → NA (not governed for findings)
 *   - openFindingsCount rose vs prior        → N  (filed without draining — regression)
 *   - oldest open finding older than 14 days → P  (stale: filed but left un-promoted)
 *   - drained / fresh / non-regressing       → Y
 *
 * A drained spool (count 0) is always Y. Mere presence of fresh findings is Y only
 * when the count did not rise vs the recorded prior; filing more is never an
 * improvement signal.
 */
export function probeFindingHygiene(root: string): DimensionEntry {
  const base = {
    id: FINDING_HYGIENE_ID,
    title: FINDING_HYGIENE_TITLE,
    ...DISC_T1,
  }
  const stats = readFindingsSpool(root)
  if (stats === null) {
    return {
      ...base,
      verdict: 'NA',
      evidence: {
        file: FINDINGS_DIR,
        detail: 'no findings spool — not governed for incidental-finding hygiene',
      },
    }
  }

  const prior = readFindingHygienePrior(root)
  // Regression: open count rose vs the recorded prior (findings filed, none drained).
  if (prior !== null && stats.openCount > prior) {
    return {
      ...base,
      verdict: 'N',
      evidence: {
        file: FINDINGS_DIR,
        detail: `openFindingsCount rose ${prior} → ${stats.openCount} — findings filed without draining`,
      },
    }
  }
  // Stale: oldest open finding left un-promoted past the threshold.
  if (stats.openCount > 0 && stats.oldestAgeDays > FINDING_STALE_DAYS) {
    return {
      ...base,
      verdict: 'P',
      evidence: {
        file: FINDINGS_DIR,
        detail: `oldest open finding is ${stats.oldestAgeDays}d (> ${FINDING_STALE_DAYS}d) — promote or drain`,
      },
    }
  }
  return {
    ...base,
    verdict: 'Y',
    evidence: {
      file: FINDINGS_DIR,
      detail:
        stats.openCount === 0
          ? 'spool drained — no open findings'
          : `${stats.openCount} open finding(s), fresh and non-regressing`,
    },
  }
}
