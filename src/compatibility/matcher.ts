// SPDX-License-Identifier: Apache-2.0
import type { SemVer } from './parsers.js'

/**
 * Raised when a range string contains a constraint we cannot parse (#854).
 *
 * Distinguishes "user's version is outside the range" (legitimate user-facing
 * failure) from "matrix.json contains an unparseable constraint" (matrix-author
 * bug surfaced as a misleading 'version outside range' message before this
 * type existed).
 */
export class UnparseableConstraintError extends Error {
  constructor(
    public readonly constraint: string,
    public readonly range: string,
  ) {
    super(
      `unparseable matrix constraint "${constraint}" (range="${range}") — ` +
        `valid forms: ">=18", ">=18 <22", ">=1.21", ">=3 <=3.9" (major or major.minor)`,
    )
    this.name = 'UnparseableConstraintError'
  }
}

/**
 * Simple major.minor range matcher. Supports constraints like:
 *   ">=18", ">=18 <22", ">18", ">=1.21", ">=3 <=3.9"
 *
 * Patch is ignored — ranges are expressed at major or major.minor granularity.
 *
 * Throws `UnparseableConstraintError` if any constraint in the range cannot
 * be parsed. Callers should catch and surface as a matrix-author bug, not
 * as a "version outside range" failure for the user (#854).
 */
export function matches(ver: SemVer, range: string): boolean {
  const trimmed = range.trim()
  if (trimmed === '') {
    throw new UnparseableConstraintError('', range)
  }
  const constraints = trimmed.split(/\s+/)
  for (const constraint of constraints) {
    if (!satisfies(ver, constraint, range)) return false
  }
  return true
}

function satisfies(ver: SemVer, constraint: string, fullRange: string): boolean {
  const m = constraint.match(/^(>=|<=|>|<)(\d+)(?:\.(\d+))?$/)
  if (!m) {
    throw new UnparseableConstraintError(constraint, fullRange)
  }
  const [, op, rawMaj, rawMin] = m
  if (op === undefined || rawMaj === undefined) {
    throw new UnparseableConstraintError(constraint, fullRange)
  }

  const cmpMajor = +rawMaj
  const cmpMinor = rawMin !== undefined ? +rawMin : undefined

  const verNumeric = cmpMinor !== undefined ? ver.major * 10_000 + ver.minor : ver.major * 10_000

  const cmpNumeric = cmpMinor !== undefined ? cmpMajor * 10_000 + cmpMinor : cmpMajor * 10_000

  switch (op) {
    case '>=':
      return verNumeric >= cmpNumeric
    case '<=':
      return verNumeric <= cmpNumeric
    case '>':
      return verNumeric > cmpNumeric
    case '<':
      return verNumeric < cmpNumeric
    default:
      throw new UnparseableConstraintError(constraint, fullRange)
  }
}

/**
 * Validate every `range` in the supplied entries by running it through the
 * matcher against a sentinel version. Surfaces matrix-author bugs at
 * load time rather than at user-probe time. (#854)
 *
 * Returns the list of `(tool, range, reason)` triples that failed to parse;
 * empty list means every range is well-formed.
 */
export function validateRanges(
  entries: ReadonlyArray<{ tool: string; range: string }>,
): Array<{ tool: string; range: string; reason: string }> {
  const SENTINEL: SemVer = { major: 99, minor: 99, patch: 0 }
  const failures: Array<{ tool: string; range: string; reason: string }> = []
  for (const { tool, range } of entries) {
    try {
      matches(SENTINEL, range)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      failures.push({ tool, range, reason })
    }
  }
  return failures
}
