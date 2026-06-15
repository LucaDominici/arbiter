// SPDX-License-Identifier: Apache-2.0
// commands/conformance.ts — `arbiter conformance` command (#1369, C5 #1397).
//
// Scores a project against the arbiter gold-pattern standard and emits a
// per-dimension matrix (pass / partial / fail / skip + evidence ref).
//
// Dimension families:
//   reality-contact  — D-TEST-LEVELS, D-LIVE-E2E, D-FE-RENDER-GATE, D-DOMAIN-API, D-DONE-EVIDENCE
//   discipline       — D-GATE-GREEN, D-COVERAGE-THRESHOLDS, D-INVARIANTS-ENFORCED, D-NO-OVERCLAIM, D-COMMIT-HYGIENE
//   docs-convention  — DOC-README, DOC-CHANGELOG, DOC-ADR, DOC-CONTRIBUTING, DOC-LICENSE, DOC-API-DOCS, DOC-SECURITY
//
// Design: deterministic, code-computed, never AI-scored. Pure functions in
// src/conformance/dimensions.ts and src/conformance/doc-probes.ts keep probe logic testable.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  probeDTestLevels,
  probeDLiveE2e,
  probeDFeRenderGate,
  probeDDomainApi,
  probeDDoneEvidence,
  probeGateGreen,
  probeCoverageThresholds,
  probeInvariantsEnforced,
  probeNoOverclaim,
  probeCommitHygiene,
} from '../conformance/dimensions.js'
import type { DimensionEntry } from '../conformance/dimensions.js'
import {
  probeDDocReadme,
  probeDDocChangelog,
  probeDDocAdr,
  probeDDocContributing,
  probeDDocLicense,
  probeDDocApiDocs,
  probeDDocSecurity,
} from '../conformance/doc-probes.js'
import { computeSummary } from '../conformance/render.js'
import { computeConformance } from '../conformance/score.js'
import type { TwoTierResult } from '../conformance/score.js'
import { autoFillConformanceThresholds } from '../config/schema.js'
import type { GovernanceLevel } from '../wizard/types.js'

export type { DimensionVerdict } from '../conformance/dimensions.js'
export type { DimensionEntry }

export interface ConformanceOptions {
  /** Project root to evaluate (default: process.cwd()). */
  dir?: string
  /** Exit non-zero on partial results too (default: fail only). */
  failOn?: 'fail' | 'partial'
  /** Apply `--strict` mode: NV dims > 0 -> exit 1. */
  strict?: boolean
  /** Check ratchet: compare score against baseline; score drop -> exit 1. */
  check?: boolean
  /** Update baseline when score rises or equals. */
  updateBaseline?: boolean
}

export interface ConformanceScanResult {
  /** 'ok' when all applicable dimensions pass, 'fail' when >=1 fails, 'skip' when not governed. */
  status: 'ok' | 'fail' | 'skip'
  /** Two-tier verdict: GOLD | CONFORMANT | NON-CONFORMANT. Populated when governed. */
  verdict: TwoTierResult['verdict'] | 'SKIP'
  /** Aggregate score 0-100 (pass=1, partial=0.5, fail=0; skip excluded from denominator). */
  score: number
  dimensions: DimensionEntry[]
  exitCode: 0 | 1 | 2
}

/** Valid governance levels used for threshold resolution. */
const VALID_LEVELS = new Set<string>(['L1', 'L2', 'L3', 'L4'])

/** Relative path to the conformance baseline file within `.arbiter/`. */
const BASELINE_FILE = 'conformance-baseline.json'

/** Probe IDs emitted in skip result when arbiter.json is absent. */
const ALL_PROBE_IDS = [
  'D-TEST-LEVELS',
  'D-LIVE-E2E',
  'D-FE-RENDER-GATE',
  'D-DOMAIN-API',
  'D-DONE-EVIDENCE',
  'D-GATE-GREEN',
  'D-COVERAGE-THRESHOLDS',
  'D-INVARIANTS-ENFORCED',
  'D-NO-OVERCLAIM',
  'D-COMMIT-HYGIENE',
  'DOC-README',
  'DOC-CHANGELOG',
  'DOC-ADR',
  'DOC-CONTRIBUTING',
  'DOC-LICENSE',
  'DOC-API-DOCS',
  'DOC-SECURITY',
] as const

/** Read arbiter.json from root, returning null if absent or malformed. */
function loadArbiterJson(root: string): Record<string, unknown> | null {
  const abs = resolve(root, 'arbiter.json')
  if (!existsSync(abs)) return null
  try {
    const text = readFileSync(abs, 'utf-8')
    const parsed: unknown = JSON.parse(text) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/** Read `.arbiter/conformance-baseline.json`, returning null if absent or malformed. */
function readBaseline(root: string): { score: number } | null {
  const abs = resolve(root, '.arbiter', BASELINE_FILE)
  if (!existsSync(abs)) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(abs, 'utf-8')) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      const rec = parsed as Record<string, unknown>
      if (typeof rec['score'] === 'number') return { score: rec['score'] }
    }
    return null
  } catch {
    return null
  }
}

/** Write `.arbiter/conformance-baseline.json` with the current score. */
function writeBaseline(root: string, score: number): void {
  const dir = resolve(root, '.arbiter')
  mkdirSync(dir, { recursive: true })
  const abs = resolve(dir, BASELINE_FILE)
  writeFileSync(abs, JSON.stringify({ score }, null, 2) + '\n', 'utf-8')
}

/** Build the skip result returned when the project has no arbiter.json. */
function buildSkipResult(): ConformanceScanResult {
  const skipDimensions: DimensionEntry[] = ALL_PROBE_IDS.map((id) => ({
    id,
    title: id,
    family: 'reality-contact' as const,
    tier: 1 as const,
    weight: 0,
    required_at: 'L1',
    verdict: 'NA' as const,
    evidence: { file: 'arbiter.json', detail: 'absent - project is not governed' },
  }))
  return { status: 'skip', verdict: 'SKIP', score: 0, dimensions: skipDimensions, exitCode: 0 }
}

/** Core result fields (no ratchet / baseline logic). */
interface CorePayload {
  verdict: TwoTierResult['verdict']
  score: number
  dimensions: DimensionEntry[]
}

/** Apply `--check` ratchet: bootstrap when absent; fail when score drops. */
function applyCheckRatchet(root: string, payload: CorePayload): ConformanceScanResult {
  const baseline = readBaseline(root)
  if (baseline === null) {
    writeBaseline(root, payload.score)
    return { status: 'ok', ...payload, exitCode: 0 }
  }
  if (payload.score < baseline.score) {
    return { status: 'fail', ...payload, exitCode: 1 }
  }
  return { status: 'ok', ...payload, exitCode: 0 }
}

/** Apply `--update-baseline`: write only when score rises; no-op on equal; fail on drop. */
function applyUpdateBaseline(root: string, payload: CorePayload): ConformanceScanResult {
  const baseline = readBaseline(root)
  if (baseline !== null) {
    if (payload.score < baseline.score) return { status: 'fail', ...payload, exitCode: 1 }
    if (payload.score === baseline.score) return { status: 'ok', ...payload, exitCode: 0 }
  }
  writeBaseline(root, payload.score)
  return { status: 'ok', ...payload, exitCode: 0 }
}

/** Collect all 17 dimension probes for a governed project. */
function collectDimensions(root: string, archetype: string | null): DimensionEntry[] {
  return [
    probeDTestLevels(root),
    probeDLiveE2e(root, archetype),
    probeDFeRenderGate(root, archetype),
    probeDDomainApi(root),
    probeDDoneEvidence(root),
    probeGateGreen(root),
    probeCoverageThresholds(root),
    probeInvariantsEnforced(root),
    probeNoOverclaim(root),
    probeCommitHygiene(root),
    probeDDocReadme(root),
    probeDDocChangelog(root),
    probeDDocAdr(root),
    probeDDocContributing(root),
    probeDDocLicense(root),
    probeDDocApiDocs(root),
    probeDDocSecurity(root),
  ]
}

/** Resolve governance level from arbiter config, defaulting to L1. */
function resolveGovernanceLevel(config: Record<string, unknown>): GovernanceLevel {
  const raw = config['governanceLevel']
  return typeof raw === 'string' && VALID_LEVELS.has(raw) ? (raw as GovernanceLevel) : 'L1'
}

/** Compute the default pass/fail outcome from summary + options (no ratchet). */
function computeDefaultResult(
  payload: CorePayload,
  failOn: 'fail' | 'partial',
  strict: boolean,
  summary: { n: number; p: number; nv: number },
): ConformanceScanResult {
  const shouldFail =
    summary.n > 0 || (failOn === 'partial' && summary.p > 0) || (strict && summary.nv > 0)
  return { status: shouldFail ? 'fail' : 'ok', ...payload, exitCode: shouldFail ? 1 : 0 }
}

/**
 * Run the conformance scorecard against a project.
 *
 * Deterministic: identical repo state => identical result.
 * Fail-safe: IO errors in any probe are caught; the probe returns 'fail' with an error detail.
 *
 * Exit codes (INV-53): 0=pass, 1=fail, 2=error.
 */
export function runConformance(opts: ConformanceOptions = {}): ConformanceScanResult {
  const root = resolve(opts.dir ?? process.cwd())
  const failOn = opts.failOn ?? 'fail'
  const strict = opts.strict ?? false

  const arbiterConfig = loadArbiterJson(root)
  if (arbiterConfig === null) return buildSkipResult()

  const archetype =
    typeof arbiterConfig['archetype'] === 'string' ? arbiterConfig['archetype'] : null
  const governanceLevel = resolveGovernanceLevel(arbiterConfig)

  const dimensions = collectDimensions(root, archetype)
  const summary = computeSummary(dimensions)
  const thresholds = autoFillConformanceThresholds(governanceLevel)
  const twoTier = computeConformance(dimensions, thresholds)
  const payload: CorePayload = { verdict: twoTier.verdict, score: summary.score, dimensions }

  if (opts.check) return applyCheckRatchet(root, payload)
  if (opts.updateBaseline) return applyUpdateBaseline(root, payload)
  return computeDefaultResult(payload, failOn, strict, summary)
}

/** Return mtime of the baseline file, or null if absent. */
export function baselineMtime(root: string): number | null {
  const abs = resolve(root, '.arbiter', BASELINE_FILE)
  try {
    return statSync(abs).mtimeMs
  } catch {
    return null
  }
}
