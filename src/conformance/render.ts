// SPDX-License-Identifier: Apache-2.0
// conformance/render.ts — terminal + JSON rendering for `arbiter conformance` (#1369, C5 #1397).

import type { DimensionEntry, Evidence } from './dimensions.js'

/** Minimal result shape needed for markdown rendering (avoids circular deps with commands/). */
interface RenderableResult {
  verdict: string
  score: number
}

export interface ConformanceSummary {
  score: number
  y: number
  p: number
  n: number
  na: number
  nv: number
  total: number
}

/** Compute aggregate score from dimension entries. */
export function computeSummary(dimensions: DimensionEntry[]): ConformanceSummary {
  const y = dimensions.filter((d) => d.verdict === 'Y').length
  const p = dimensions.filter((d) => d.verdict === 'P').length
  const n = dimensions.filter((d) => d.verdict === 'N').length
  const na = dimensions.filter((d) => d.verdict === 'NA').length
  const nv = dimensions.filter((d) => d.verdict === 'NV').length
  const total = dimensions.length

  // NA and NV excluded from denominator; Y=1, P=0.5, N=0
  const applicable = y + p + n
  const earned = y + p * 0.5
  const score = applicable > 0 ? Math.round((earned / applicable) * 1000) / 10 : 0

  return { score, y, p, n, na, nv, total }
}

const VERDICT_SYMBOLS: Record<string, string> = {
  Y: 'Y',
  P: 'P',
  N: 'N',
  NA: 'NA',
  NV: 'NV',
}

/** Pad a string to width. */
function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

/** Render an Evidence object to a display string. */
function renderEvidence(evidence: Evidence): string {
  const loc = evidence.line !== undefined ? `:${evidence.line}` : ''
  const detail = evidence.detail !== undefined ? ` — ${evidence.detail}` : ''
  return `${evidence.file}${loc}${detail}`
}

/** Render a text table of the dimension matrix. */
export function renderText(dimensions: DimensionEntry[], summary: ConformanceSummary): string {
  const COL_ID = 20
  const COL_VERDICT = 8
  const COL_EV = 60
  const header = `${pad('Dimension', COL_ID)} ${pad('Verdict', COL_VERDICT)} Evidence`
  const sep = '-'.repeat(COL_ID + 1 + COL_VERDICT + 1 + COL_EV)
  const rows = dimensions.map((d) => {
    const verdict = VERDICT_SYMBOLS[d.verdict] ?? d.verdict
    return `${pad(d.id, COL_ID)} ${pad(verdict, COL_VERDICT)} ${renderEvidence(d.evidence)}`
  })
  const scoreLabel = `Score: ${summary.score}% — Y ${summary.y} · P ${summary.p} · N ${summary.n} · NA ${summary.na} · NV ${summary.nv}`
  return [header, sep, ...rows, sep, scoreLabel].join('\n')
}

/** GFM table row: pad each cell to column width. */
function gfmRow(cells: string[], widths: number[]): string {
  return `| ${cells.map((c, i) => c.padEnd(widths[i] ?? 3)).join(' | ')} |`
}

/** GFM separator row. */
function gfmSep(widths: number[]): string {
  return `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`
}

/**
 * Render a markdown table with all dimensions (id | family | tier | verdict | evidence)
 * plus per-family rollup and overall verdict line.
 *
 * `result` is the RenderableResult (verdict + score); `dimensions` are all evaluated dims.
 */
export function renderConformanceMd(
  result: RenderableResult,
  dimensions: DimensionEntry[],
): string {
  const headers = ['Dimension', 'Family', 'Tier', 'Verdict', 'Evidence']
  const rows = dimensions.map((d) => [
    d.id,
    d.family,
    String(d.tier),
    d.verdict,
    renderEvidence(d.evidence),
  ])

  // Compute column widths
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length), 3),
  )

  const tableLines = [
    gfmRow(headers, widths),
    gfmSep(widths),
    ...rows.map((r) => gfmRow(r, widths)),
  ]

  // Per-family rollup
  const families = [
    'reality-contact',
    'discipline',
    'docs-convention',
    'code-quality-gold',
  ] as const
  const rollupLines = families
    .map((family) => {
      const inFamily = dimensions.filter((d) => d.family === family)
      if (inFamily.length === 0) return null
      const y = inFamily.filter((d) => d.verdict === 'Y').length
      const p = inFamily.filter((d) => d.verdict === 'P').length
      const n = inFamily.filter((d) => d.verdict === 'N').length
      const na = inFamily.filter((d) => d.verdict === 'NA').length
      const nv = inFamily.filter((d) => d.verdict === 'NV').length
      return `**${family}**: Y ${y} · P ${p} · N ${n} · NA ${na} · NV ${nv}`
    })
    .filter((l): l is string => l !== null)

  const summary = computeSummary(dimensions)

  return [
    '## Conformance Scorecard',
    '',
    tableLines.join('\n'),
    '',
    '### Per-family rollup',
    '',
    ...rollupLines,
    '',
    `**Overall verdict: ${result.verdict}** — Score: ${result.score}% (Y ${summary.y} · P ${summary.p} · N ${summary.n} · NA ${summary.na} · NV ${summary.nv})`,
  ].join('\n')
}
