// SPDX-License-Identifier: Apache-2.0
// conformance/render.ts — terminal + JSON rendering for `arbiter conformance` (#1369).

import type { DimensionEntry } from './dimensions.js'

export interface ConformanceSummary {
  score: number
  pass: number
  partial: number
  fail: number
  skip: number
  total: number
}

/** Compute aggregate score from dimension entries. */
export function computeSummary(dimensions: DimensionEntry[]): ConformanceSummary {
  const pass = dimensions.filter((d) => d.verdict === 'pass').length
  const partial = dimensions.filter((d) => d.verdict === 'partial').length
  const fail = dimensions.filter((d) => d.verdict === 'fail').length
  const skip = dimensions.filter((d) => d.verdict === 'skip').length
  const total = dimensions.length

  // Score: only over applicable (non-skip) dimensions; pass=1, partial=0.5, fail=0
  const applicable = pass + partial + fail
  const earned = pass + partial * 0.5
  const score = applicable > 0 ? Math.round((earned / applicable) * 1000) / 10 : 100

  return { score, pass, partial, fail, skip, total }
}

const VERDICT_SYMBOLS: Record<string, string> = {
  pass: 'PASS',
  partial: 'PARTIAL',
  fail: 'FAIL',
  skip: 'SKIP',
}

/** Pad a string to width. */
function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

/** Render a text table of the dimension matrix. */
export function renderText(dimensions: DimensionEntry[], summary: ConformanceSummary): string {
  const COL_ID = 20
  const COL_VERDICT = 8
  const COL_EV = 60
  const header = `${pad('Dimension', COL_ID)} ${pad('Verdict', COL_VERDICT)} Evidence`
  const sep = '-'.repeat(COL_ID + 1 + COL_VERDICT + 1 + COL_EV)
  const rows = dimensions.map((d) => {
    const verdict = VERDICT_SYMBOLS[d.verdict] ?? d.verdict.toUpperCase()
    return `${pad(d.id, COL_ID)} ${pad(verdict, COL_VERDICT)} ${d.evidence}`
  })
  const scoreLabel = `Score: ${summary.score}% — PASS ${summary.pass} · PARTIAL ${summary.partial} · FAIL ${summary.fail} · SKIP ${summary.skip}`
  return [header, sep, ...rows, sep, scoreLabel].join('\n')
}
