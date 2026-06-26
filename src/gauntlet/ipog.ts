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
 * Constraints (`skip`) are honoured *during* generation, not as a terminal
 * post-filter (#1563). A naive post-`.filter()` silently drops every valid pair
 * that a removed row was the sole carrier of; building constraint-aware instead
 * keeps every legitimate t-way combination covered by an alternative row.
 *
 * The algorithm proceeds as follows for strength t:
 *   1. Start with all value combinations of the first t parameters
 *      (cross-product), dropping any seed row that already matches a skip
 *      constraint — such a row *is* an excluded tuple, so removing it loses no
 *      required coverage.
 *   2. For each subsequent parameter p:
 *      a. Extend each existing row with a value of p that maximises newly
 *         covered t-way combinations, never choosing a value that would complete
 *         a skip-matching row (horizontal extension).
 *      b. Add new rows to cover any remaining uncovered t-way combinations
 *         involving p, again avoiding skip-matching assignments (vertical
 *         extension). Tuples that fully contain a skip constraint are never
 *         required in the first place.
 *   3. Fill remaining wildcards with the first constraint-safe value, then run a
 *      defensive assertion: if any row still matches a skip constraint the spec
 *      is over-constrained — throw rather than silently delete coverage.
 */

interface IpogConstraint {
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

/** Immutable generation context shared by the internal helpers. */
interface IpogCtx {
  params: string[]
  dimensions: Record<string, string[]>
  constraints: IpogConstraint[]
}

export function ipog(input: IpogInput): IpogRow[] {
  const { dimensions, strength, constraints = [] } = input
  const params = Object.keys(dimensions)
  const t = Math.max(1, Math.min(strength, params.length))
  const ctx: IpogCtx = { params, dimensions, constraints }

  if (params.length === 0) return []
  if (params.length <= t) {
    // Full cross-product for the first t params. Here every row is a complete
    // t-tuple, so a row matching a skip constraint *is* an excluded tuple —
    // removing it loses no required coverage. Plain removal is correct.
    return dropForbiddenRows(crossProduct(params, dimensions), constraints)
  }

  // Step 1: seed with cross-product of first t params, dropping rows that
  // already match a skip constraint (excluded tuples — see above).
  const rows: Array<Partial<IpogRow>> = dropForbiddenRows(
    crossProduct(params.slice(0, t), dimensions),
    constraints,
  )

  // Step 2: process remaining parameters one at a time
  for (let pi = t; pi < params.length; pi++) {
    const p = params[pi] ?? ''
    const values = dimensions[p] ?? []

    // Build the set of t-way tuples involving p that we still need to cover.
    // Tuples that fully contain a skip constraint are excluded up front.
    const uncovered = buildUncoveredSet(ctx, pi, t, rows)

    // Horizontal extension: for each existing row, pick the value of p that
    // covers the most uncovered tuples — but never a value that completes a
    // skip-matching row.
    for (const row of rows) {
      const bestVal = pickConstraintAwareValue(values, row, p, constraints, (v) =>
        countCovered({ ...row, [p]: v }, uncovered),
      )
      row[p] = bestVal
      removeCovered({ ...(row as IpogRow), [p]: bestVal }, uncovered)
    }

    // Vertical extension: add new rows to cover remaining uncovered tuples
    while (uncovered.size > 0) {
      const firstKey = uncovered.keys().next().value
      if (firstKey === undefined) break
      const decoded = decodeTuple(firstKey)
      const newRow = buildNewRow(ctx, decoded, pi, uncovered)
      rows.push(newRow)
      removeCovered(newRow as IpogRow, uncovered)
    }
  }

  // Step 3: fill wildcards with the first constraint-safe value
  const complete = rows.map((row) => {
    const r: IpogRow = {}
    for (const p of params) {
      const val = row[p]
      if (val !== WILD && val !== undefined) {
        r[p] = val
        continue
      }
      r[p] = pickConstraintAwareValue(dimensions[p] ?? [], r, p, constraints, () => 0)
    }
    return r
  })

  // Defensive: any surviving forbidden row means the spec is over-constrained.
  return assertNoForbiddenRows(complete, constraints)
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
 * Pick the best-scoring value for `p` on `row` that does NOT complete a skip
 * constraint. Falls back to the full value set only when every value would
 * violate a constraint (an over-constrained slot) — the surviving forbidden row
 * is then caught by the defensive assertion in `ipog()` rather than silently
 * dropped (#1563).
 */
function pickConstraintAwareValue(
  values: string[],
  row: Partial<IpogRow>,
  p: string,
  constraints: IpogConstraint[],
  scoreFn: (v: string) => number,
): string {
  const safe = values.filter((v) => !rowMatchesConstraint({ ...row, [p]: v }, constraints))
  return pickBestValue(safe.length > 0 ? safe : values, scoreFn)
}

/**
 * Build a new vertical-extension row starting from `decoded` (the required tuple),
 * filling remaining params greedily without completing a skip constraint.
 */
function buildNewRow(
  ctx: IpogCtx,
  decoded: Record<string, string>,
  pi: number,
  uncovered: Set<string>,
): Partial<IpogRow> {
  const { params, dimensions, constraints } = ctx
  const newRow: IpogRow = { ...decoded }
  // Fill params not already set
  for (const param of params.slice(0, pi + 1)) {
    if (newRow[param] === undefined) {
      const vals = dimensions[param] ?? []
      newRow[param] = pickConstraintAwareValue(vals, newRow, param, constraints, (v) =>
        countCovered({ ...newRow, [param]: v }, uncovered),
      )
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
  ctx: IpogCtx,
  pi: number,
  t: number,
  rows: Array<Partial<IpogRow>>,
): Set<string> {
  const { params, dimensions, constraints } = ctx
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
      // A tuple that fully contains a skip constraint can only be carried by a
      // forbidden row — never require it (#1563).
      if (rowMatchesConstraint(tuple, constraints)) continue
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

/**
 * Whether a (possibly partial) row fully matches a skip constraint: every key
 * in some constraint's `when` is present on the row and equal. A constraint key
 * left unassigned (`undefined`/`WILD`) does not match — the violation is only
 * realised once that key is given the offending value.
 */
function rowMatchesConstraint(row: Partial<IpogRow>, constraints: IpogConstraint[]): boolean {
  return constraints.some((c) => Object.entries(c.when).every(([k, v]) => row[k] === v))
}

/** Drop complete rows that match a skip constraint (used for cross-product seeds). */
function dropForbiddenRows<T extends Partial<IpogRow>>(
  rows: T[],
  constraints: IpogConstraint[],
): T[] {
  return rows.filter((row) => !rowMatchesConstraint(row, constraints))
}

/**
 * Defensive assertion: by construction `ipog()` never emits a forbidden row, so
 * a surviving match means the spec is over-constrained (a slot forced into a
 * skip). Throw loudly instead of silently deleting coverage (#1563).
 */
function assertNoForbiddenRows(rows: IpogRow[], constraints: IpogConstraint[]): IpogRow[] {
  for (const row of rows) {
    if (rowMatchesConstraint(row, constraints)) {
      throw new Error(
        `gauntlet: over-constrained spec — generated row ${JSON.stringify(row)} ` +
          `unavoidably matches a skip constraint; relax the constraints or add parameter values`,
      )
    }
  }
  return rows
}
