// SPDX-License-Identifier: Apache-2.0
import { resolve, dirname } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { loadRepoData } from '../compare/load-repo.js'
import {
  detectDivergentEnforcement,
  detectContradictoryAdrs,
  detectPromotionAsymmetry,
  detectUniqueToOneRepo,
  detectRiskClassDivergence,
} from '../compare/detectors.js'
import { renderCompareReport } from '../compare/report.js'
import { parseWorkspaceFile } from '../compare/workspace.js'
import type { CompareFinding } from '../compare/model.js'

/**
 * `arbiter compare <paths...>` — cross-repo governance comparison (#264).
 *
 * Loads the provenance graph from each repo (or falls back to the INV catalog),
 * runs five detectors, and returns a structured result. Optionally writes a
 * markdown report and supports `--fail-on contradiction` for gate mode.
 */

export interface CompareOptions {
  /** Direct repo paths to compare (positional args). */
  paths?: string[] | undefined
  /** Path to a workspace YAML spec (alternative to paths). */
  workspace?: string
  /** Topic filter — only include findings whose summary/invId matches. */
  topic?: string
  /** Exit non-zero when findings of this type are found. */
  failOn?: 'contradiction' | 'divergence' | 'any'
  /** Write markdown report to this file path. */
  format?: string
  json?: boolean
}

export interface CompareResult {
  status: 'ok' | 'error'
  exitCode: 0 | 1 | 2
  reposLoaded: number
  findings: CompareFinding[]
  warnings: string[]
  reason?: string
  reportPath?: string
}

export function runCompare(opts: CompareOptions): CompareResult {
  // 1. Resolve repo paths
  const rawPaths = resolvePaths(opts)
  if (rawPaths.length === 0) {
    return {
      status: 'error',
      exitCode: 2,
      reposLoaded: 0,
      findings: [],
      warnings: [],
      reason: 'No repo paths provided. Pass paths as arguments or use --workspace.',
    }
  }

  const resolvedPaths = rawPaths.map((p) => resolve(p))

  // 2. Load each repo
  const warnings: string[] = []
  const repoDataList = resolvedPaths.map((p) => {
    const { data, warning } = loadRepoData(p)
    if (warning !== undefined) warnings.push(warning)
    return data
  })

  // 3. Run all detectors
  const allFindings: CompareFinding[] = [
    ...detectDivergentEnforcement(repoDataList),
    ...detectContradictoryAdrs(repoDataList),
    ...detectPromotionAsymmetry(repoDataList),
    ...detectUniqueToOneRepo(repoDataList),
    ...detectRiskClassDivergence(repoDataList),
  ]

  // 4. Apply topic filter
  const findings = opts.topic !== undefined ? filterByTopic(allFindings, opts.topic) : allFindings

  // 5. Write report if requested
  let reportPath: string | undefined
  if (opts.format !== undefined) {
    const resolvedReport = resolve(opts.format)
    const content = renderCompareReport({ repos: repoDataList, findings, warnings })
    try {
      mkdirSync(dirname(resolvedReport), { recursive: true })
      writeFileSync(resolvedReport, content, 'utf-8')
      reportPath = resolvedReport
    } catch (err) {
      warnings.push(`Failed to write report: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 6. Compute exit code
  const exitCode = computeExitCode(findings, opts.failOn)

  return {
    status: 'ok',
    exitCode,
    reposLoaded: resolvedPaths.length,
    findings,
    warnings,
    ...(reportPath !== undefined ? { reportPath } : {}),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolvePaths(opts: CompareOptions): string[] {
  if (opts.workspace !== undefined) {
    const outcome = parseWorkspaceFile(resolve(opts.workspace))
    if (!outcome.ok) return []
    return outcome.spec.repos.map((r) => r.path)
  }
  return opts.paths ?? []
}

function filterByTopic(findings: CompareFinding[], topic: string): CompareFinding[] {
  const lower = topic.toLowerCase()
  return findings.filter(
    (f) =>
      f.invId.toLowerCase().includes(lower) ||
      f.summary.toLowerCase().includes(lower) ||
      f.repos.some((r) => r.toLowerCase().includes(lower)) ||
      (f.detail ?? []).some((d) => d.toLowerCase().includes(lower)),
  )
}

function computeExitCode(findings: CompareFinding[], failOn: CompareOptions['failOn']): 0 | 1 | 2 {
  if (failOn === undefined) return 0
  if (failOn === 'any' && findings.length > 0) return 1
  if (failOn === 'divergence') {
    const hasDivergence = findings.some(
      (f) => f.type === 'divergent-enforcement' || f.type === 'risk-class-divergence',
    )
    if (hasDivergence) return 1
  }
  if (failOn === 'contradiction') {
    const hasContradiction = findings.some((f) => f.type === 'contradictory-adr')
    if (hasContradiction) return 1
  }
  return 0
}
