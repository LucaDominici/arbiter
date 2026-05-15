// SPDX-License-Identifier: Apache-2.0
/**
 * IPOG (In-Parameter-Order General) pairwise / t-way test generation (#260).
 *
 * Reference: Lei, Y. & Tai, K.C. (1998). "In-parameter-order: A test generation
 * strategy for pairwise testing".
 *
 * This is a deterministic implementation:
 *   - Parameters are processed in the order they appear in `dimensions`
 *   - Value selection uses first-uncovered greedy search (no randomness)
 *   - Output row order is stable across calls with identical input
 *
 * The algorithm proceeds as follows for strength t:
 *   1. Start with all value combinations of the first t parameters (cross-product).
 *   2. For each subsequent parameter p:
 *      a. Extend each existing row with a value of p that maximises
 *         newly covered t-way combinations (horizontal extension).
 *      b. Add new rows to cover any remaining uncovered t-way combinations
 *         involving p (vertical extension).
 *   3. Apply constraint pruning: remove / replace rows matching skip constraints.
 */

export interface IpogConstraint {
  when: Record<string, string>
  then: 'skip'
}

export interface IpogInput {
  dimensions: Record<string, string[]>
  strength: number
  constraints?: IpogConstraint[]
}

export type IpogRow = Record<string, string>

/** Wildcard sentinel — a slot not yet assigned. */
const WILD = '*'

export function ipog(input: IpogInput): IpogRow[] {
  const { dimensions, strength, constraints = [] } = input
  const params = Object.keys(dimensions)
  const t = Math.max(1, Math.min(strength, params.length))

  if (params.length === 0) return []
  if (params.length <= t) {
    // Full cross-product for the first t params
    return filterConstraints(crossProduct(params, dimensions), constraints)
  }

  // Step 1: seed with cross-product of first t params
  const rows: Array<Partial<IpogRow>> = crossProduct(params.slice(0, t), dimensions)

  // Step 2: process remaining parameters one at a time
  for (let pi = t; pi < params.length; pi++) {
    const p = params[pi] ?? ''
    const values = dimensions[p] ?? []

    // Build the set of t-way tuples involving p that we still need to cover
    const uncovered = buildUncoveredSet(params, dimensions, pi, t, rows)

    // Horizontal extension: for each existing row, pick the value of p
    // that covers the most uncovered tuples
    for (const row of rows) {
      const bestVal = pickBestValue(values, (v) => countCovered({ ...row, [p]: v }, uncovered))
      row[p] = bestVal
      removeCovered({ ...(row as IpogRow), [p]: bestVal }, uncovered)
    }

    // Vertical extension: add new rows to cover remaining uncovered tuples
    while (uncovered.size > 0) {
      const firstKey = uncovered.keys().next().value
      if (firstKey === undefined) break
      const decoded = decodeTuple(firstKey)
      const newRow = buildNewRow(decoded, params, pi, dimensions, uncovered)
      rows.push(newRow)
      removeCovered(newRow as IpogRow, uncovered)
    }
  }

  // Step 3: fill wildcards with first available value
  const complete = rows.map((row) => {
    const r: IpogRow = {}
    for (const p of params) {
      const val = row[p]
      r[p] = val === WILD || val === undefined ? (dimensions[p]?.[0] ?? '') : val
    }
    return r
  })

  return filterConstraints(complete, constraints)
}

// ── internals ────────────────────────────────────────────────────────────────

/** Pick the value from `values` that maximises `scoreFn`. Returns first if all equal. */
function pickBestValue(values: string[], scoreFn: (v: string) => number): string {
  let bestVal = values[0] ?? ''
  let bestScore = -1
  for (const v of values) {
    const score = scoreFn(v)
    if (score > bestScore) {
      bestScore = score
      bestVal = v
    }
  }
  return bestVal
}

/**
 * Build a new vertical-extension row starting from `decoded` (the required tuple),
 * filling remaining params greedily.
 */
function buildNewRow(
  decoded: Record<string, string>,
  params: string[],
  pi: number,
  dimensions: Record<string, string[]>,
  uncovered: Set<string>,
): Partial<IpogRow> {
  const newRow: IpogRow = { ...decoded }
  // Fill params not already set
  for (const param of params.slice(0, pi + 1)) {
    if (newRow[param] === undefined) {
      const vals = dimensions[param] ?? []
      newRow[param] = pickBestValue(vals, (v) => countCovered({ ...newRow, [param]: v }, uncovered))
    }
  }
  // Fill later params (not yet processed) with wildcard
  for (const param of params.slice(pi + 1)) {
    newRow[param] = WILD
  }
  return newRow
}

/** Full cross-product of the given params. */
function crossProduct(params: string[], dimensions: Record<string, string[]>): IpogRow[] {
  let result: IpogRow[] = [{}]
  for (const p of params) {
    const next: IpogRow[] = []
    for (const row of result) {
      for (const v of dimensions[p] ?? []) {
        next.push({ ...row, [p]: v })
      }
    }
    result = next
  }
  return result
}

/**
 * Build the set of all t-way tuples that MUST include the new param `p` at
 * index `pi`, using combinations of the previous (pi) params with p.
 *
 * Returns a Set of encoded tuple keys.
 */
function buildUncoveredSet(
  params: string[],
  dimensions: Record<string, string[]>,
  pi: number,
  t: number,
  rows: Array<Partial<IpogRow>>,
): Set<string> {
  const p = params[pi] ?? ''
  const prevParams = params.slice(0, pi)
  const uncovered = new Set<string>()

  // For each (t-1)-combination of prevParams, cross with each value of p
  for (const subset of combinations(prevParams, t - 1)) {
    const subsetWithP = [...subset, p]
    const valueCombos = cartesian(subsetWithP.map((param) => dimensions[param] ?? []))
    for (const combo of valueCombos) {
      const tuple: Record<string, string> = {}
      for (let i = 0; i < subsetWithP.length; i++) {
        const paramKey = subsetWithP[i]
        const comboVal = combo[i]
        if (paramKey !== undefined && comboVal !== undefined) {
          tuple[paramKey] = comboVal
        }
      }
      const key = encodeTuple(tuple)
      // Only add if not already covered by existing rows
      if (!isAlreadyCovered(tuple, rows)) {
        uncovered.add(key)
      }
    }
  }
  return uncovered
}

function isAlreadyCovered(tuple: Record<string, string>, rows: Array<Partial<IpogRow>>): boolean {
  for (const row of rows) {
    if (Object.entries(tuple).every(([k, v]) => row[k] === v)) return true
  }
  return false
}

function countCovered(candidate: Partial<IpogRow>, uncovered: Set<string>): number {
  let count = 0
  for (const key of uncovered) {
    const tuple = decodeTuple(key)
    if (Object.entries(tuple).every(([k, v]) => candidate[k] === v)) {
      count++
    }
  }
  return count
}

function removeCovered(row: IpogRow, uncovered: Set<string>): void {
  for (const key of Array.from(uncovered)) {
    const tuple = decodeTuple(key)
    if (Object.entries(tuple).every(([k, v]) => row[k] === v)) {
      uncovered.delete(key)
    }
  }
}

function encodeTuple(tuple: Record<string, string>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(tuple).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  )
}

function decodeTuple(key: string): Record<string, string> {
  return JSON.parse(key) as Record<string, string>
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [head, ...tail] = arr
  const withHead = combinations(tail, k - 1).map((rest) => [head as T, ...rest])
  return [...withHead, ...combinations(tail, k)]
}

function cartesian(slots: string[][]): string[][] {
  if (slots.length === 0) return [[]]
  const [first, ...rest] = slots
  const restProd = cartesian(rest)
  const result: string[][] = []
  for (const v of first ?? []) {
    for (const r of restProd) {
      result.push([v, ...r])
    }
  }
  return result
}

/** Remove rows that match any skip constraint. */
function filterConstraints(rows: IpogRow[], constraints: IpogConstraint[]): IpogRow[] {
  return rows.filter(
    (row) => !constraints.some((c) => Object.entries(c.when).every(([k, v]) => row[k] === v)),
  )
}
