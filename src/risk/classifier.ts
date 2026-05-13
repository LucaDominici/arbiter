/**
 * Risk classifier for changed-file paths (#238).
 *
 * Maps a path + stack to one of R0..R4 (R0 = highest risk, R4 = lowest)
 * OR returns `UNCLASSIFIED_LEVEL` ("R-unknown") when no rule matches.
 *
 * Used by `arbiter verify evidence` to decide which evidence checks are
 * required for the change set.
 *
 * Semantics on unclassified inputs:
 *   - Bad/empty path             → UNCLASSIFIED_LEVEL
 *   - Unknown / unsupported stack → UNCLASSIFIED_LEVEL
 *   - No rule matched            → UNCLASSIFIED_LEVEL
 *
 * `UNCLASSIFIED_LEVEL` is intentionally NOT a numeric risk bucket —
 * it means "we have no opinion; the consumer must decide". Callers that
 * require a real risk level (e.g. evidence gating) should treat it as
 * "needs manual review" and use `assertClassified()` to fail loudly.
 *
 * Rules are deliberately conservative and per-stack — additional stacks
 * fall through to `UNCLASSIFIED_LEVEL` to encourage explicit rule curation
 * before promotion.
 */

import type { Language } from '../wizard/types.js'

export type RiskLevel = 'R0' | 'R1' | 'R2' | 'R3' | 'R4'

/**
 * Sentinel emitted when classification cannot be performed.
 * NOT a risk level — explicitly out-of-band.
 */
export const UNCLASSIFIED_LEVEL = 'R-unknown' as const
export type Unclassified = typeof UNCLASSIFIED_LEVEL

export type ClassifyResult = RiskLevel | Unclassified

interface Rule {
  /** Regex tested against the normalised forward-slash path. */
  pattern: RegExp
  level: RiskLevel
}

/**
 * Rules are evaluated in order; first match wins. Per stack, order matters:
 * highest-risk patterns must be listed first.
 */
const RULES: Partial<Record<Language, Rule[]>> = {
  typescript: [
    { pattern: /(^|\/)migrations?\//i, level: 'R0' },
    { pattern: /\.sql$/i, level: 'R0' },
    { pattern: /(^|\/)auth\//i, level: 'R1' },
    { pattern: /(^|\/)payment(s)?\//i, level: 'R1' },
    { pattern: /(^|\/)api\//i, level: 'R2' },
    { pattern: /(^|\/)server\//i, level: 'R2' },
    { pattern: /(^|\/)components?\//i, level: 'R3' },
    { pattern: /(^|\/)pages?\//i, level: 'R3' },
    { pattern: /\.md$/i, level: 'R4' },
    { pattern: /(^|\/)docs?\//i, level: 'R4' },
    { pattern: /(^|\/)__tests__\//, level: 'R4' },
  ],
  python: [
    { pattern: /(^|\/)alembic\/versions\//i, level: 'R0' },
    { pattern: /(^|\/)migrations?\//i, level: 'R0' },
    { pattern: /(^|\/)auth\//i, level: 'R1' },
    { pattern: /(^|\/)api\//i, level: 'R2' },
    { pattern: /(^|\/)tests?\//i, level: 'R4' },
    { pattern: /\.md$/i, level: 'R4' },
  ],
  rust: [
    { pattern: /unsafe/i, level: 'R0' },
    { pattern: /(^|\/)migrations?\//i, level: 'R0' },
    { pattern: /\.rs$/i, level: 'R2' },
    { pattern: /\.md$/i, level: 'R4' },
  ],
  java: [
    { pattern: /(^|\/)migration(s)?\/.*\.sql$/i, level: 'R0' },
    { pattern: /(^|\/)security\//i, level: 'R1' },
    { pattern: /\.md$/i, level: 'R4' },
  ],
  go: [
    { pattern: /(^|\/)migrations?\//i, level: 'R0' },
    { pattern: /(^|\/)auth\//i, level: 'R1' },
    { pattern: /\.go$/i, level: 'R2' },
    { pattern: /\.md$/i, level: 'R4' },
  ],
}

/**
 * Classify a single path. Returns `UNCLASSIFIED_LEVEL` when the path is
 * malformed, the stack is unsupported, or no rule matches — callers MUST
 * decide whether unclassified means "low risk" or "manual review required".
 *
 * @param path  Repository-relative path. Backslashes are normalised to "/".
 * @param stack Language stack (Language from wizard/types).
 */
export function classifyPath(path: string, stack: Language): ClassifyResult {
  try {
    if (typeof path !== 'string' || path.trim() === '') {
      return UNCLASSIFIED_LEVEL
    }
    const rules = RULES[stack]
    if (!rules) return UNCLASSIFIED_LEVEL
    const norm = path.replace(/\\/g, '/')
    for (const rule of rules) {
      if (rule.pattern.test(norm)) {
        return rule.level
      }
    }
    return UNCLASSIFIED_LEVEL
  } catch {
    return UNCLASSIFIED_LEVEL
  }
}

/** Type-guard: true when a `ClassifyResult` is a real RiskLevel (R0–R4). */
export function isClassified(level: ClassifyResult): level is RiskLevel {
  return level !== UNCLASSIFIED_LEVEL
}

/**
 * Fail-closed helper for callers that cannot proceed without a real
 * risk level. Throws if the result is `UNCLASSIFIED_LEVEL`.
 *
 * Use this in evidence gating, CI gates, or any place where "no opinion"
 * must be treated as "block until a human classifies".
 */
export function assertClassified(level: ClassifyResult, context?: string): RiskLevel {
  if (level === UNCLASSIFIED_LEVEL) {
    const where = context ? ` (${context})` : ''
    throw new Error(
      `classifyPath returned UNCLASSIFIED${where} — refusing to fail open. ` +
        `Add a rule for this path/stack or treat as manual-review.`,
    )
  }
  return level
}

/**
 * Numeric ordering for risk comparison. Lower index = higher risk.
 * Useful for `Math.min`-style "pick the most dangerous level seen".
 */
const RISK_ORDER: RiskLevel[] = ['R0', 'R1', 'R2', 'R3', 'R4']

/**
 * Return the highest-risk level among the inputs (R0 wins over R1, etc.).
 * `UNCLASSIFIED_LEVEL` propagates: if ANY input is unclassified, the
 * combined result is unclassified (fail-closed semantic).
 *
 * Returns UNCLASSIFIED_LEVEL on empty input.
 */
export function highestRisk(levels: readonly ClassifyResult[]): ClassifyResult {
  if (levels.length === 0) return UNCLASSIFIED_LEVEL
  let best: RiskLevel | null = null
  for (const l of levels) {
    if (l === UNCLASSIFIED_LEVEL) return UNCLASSIFIED_LEVEL
    if (best === null || RISK_ORDER.indexOf(l) < RISK_ORDER.indexOf(best)) {
      best = l
    }
  }
  return best ?? UNCLASSIFIED_LEVEL
}
