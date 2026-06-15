// SPDX-License-Identifier: Apache-2.0
// commands/conformance.ts — `arbiter conformance` command (#1369).
//
// Scores a project against the arbiter gold-pattern standard and emits a
// per-dimension matrix (pass / partial / fail / skip + evidence ref).
//
// Dimensions:
//   D-TEST-LEVELS      — Declared test levels populated (test-pyramid.json)
//   D-LIVE-E2E         — Non-mocked live API e2e layer exists and runs
//   D-FE-RENDER-GATE   — FE archetypes have a behavioural/visual gate
//   D-DOMAIN-API       — Domain↔API surface completeness checked
//   D-DONE-EVIDENCE    — Done-evidence requires reality-contact
//
// Design: deterministic, code-computed, never AI-scored. Pure functions in
// src/conformance/dimensions.ts keep probe logic testable without CLI wiring.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  probeDTestLevels,
  probeDLiveE2e,
  probeDFeRenderGate,
  probeDDomainApi,
  probeDDoneEvidence,
} from '../conformance/dimensions.js'
import type { DimensionEntry } from '../conformance/dimensions.js'
import { computeSummary } from '../conformance/render.js'

export type { DimensionVerdict } from '../conformance/dimensions.js'
export type { DimensionEntry }

export interface ConformanceOptions {
  /** Project root to evaluate (default: process.cwd()). */
  dir?: string
  /** Exit non-zero on partial results too (default: fail only). */
  failOn?: 'fail' | 'partial'
}

export interface ConformanceResult {
  /** 'ok' when all applicable dimensions pass, 'fail' when ≥1 fails, 'skip' when not governed. */
  status: 'ok' | 'fail' | 'skip'
  /** Aggregate score 0–100 (pass=1, partial=0.5, fail=0; skip excluded from denominator). */
  score: number
  dimensions: DimensionEntry[]
  exitCode: 0 | 1
}

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

/**
 * Run the conformance scorecard against a project.
 *
 * Deterministic: identical repo state ⇒ identical result.
 * Fail-safe: IO errors in any probe are caught; the probe returns 'fail' with an error detail.
 */
export function runConformance(opts: ConformanceOptions = {}): ConformanceResult {
  const root = resolve(opts.dir ?? process.cwd())
  const failOn = opts.failOn ?? 'fail'

  // If no arbiter.json, project is not a governed arbiter project → all skip.
  const arbiterConfig = loadArbiterJson(root)
  if (arbiterConfig === null) {
    const skipDimensions: DimensionEntry[] = [
      'D-TEST-LEVELS',
      'D-LIVE-E2E',
      'D-FE-RENDER-GATE',
      'D-DOMAIN-API',
      'D-DONE-EVIDENCE',
    ].map((id) => ({
      id,
      title: id,
      verdict: 'skip' as const,
      evidence: 'arbiter.json absent — project is not governed',
    }))
    return { status: 'skip', score: 100, dimensions: skipDimensions, exitCode: 0 }
  }

  const archetype =
    typeof arbiterConfig['archetype'] === 'string' ? arbiterConfig['archetype'] : null

  // Run all dimension probes
  const dimensions: DimensionEntry[] = [
    probeDTestLevels(root),
    probeDLiveE2e(root),
    probeDFeRenderGate(root, archetype),
    probeDDomainApi(root),
    probeDDoneEvidence(root),
  ]

  const summary = computeSummary(dimensions)

  const hasFail = summary.fail > 0
  const hasPartial = summary.partial > 0
  const shouldFail = hasFail || (failOn === 'partial' && hasPartial)

  return {
    status: shouldFail ? 'fail' : 'ok',
    score: summary.score,
    dimensions,
    exitCode: shouldFail ? 1 : 0,
  }
}
