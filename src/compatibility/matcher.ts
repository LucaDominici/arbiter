// SPDX-License-Identifier: Apache-2.0
import type { SemVer } from './parsers.js'

/**
 * Simple major.minor range matcher. Supports constraints like:
 *   ">=18", ">=18 <22", ">18", ">=1.21", ">=3 <=3.9"
 *
 * Patch is ignored — ranges are expressed at major or major.minor granularity.
 */
export function matches(ver: SemVer, range: string): boolean {
  const constraints = range.trim().split(/\s+/)
  for (const constraint of constraints) {
    if (!satisfies(ver, constraint)) return false
  }
  return true
}

function satisfies(ver: SemVer, constraint: string): boolean {
  const m = constraint.match(/^(>=|<=|>|<)(\d+)(?:\.(\d+))?$/)
  if (!m) return false
  const [, op, rawMaj, rawMin] = m
  if (op === undefined || rawMaj === undefined) return false

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
      return false
  }
}
