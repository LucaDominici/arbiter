import { createRequire } from 'node:module'
import type { Language } from '../wizard/types.js'

const require = createRequire(import.meta.url)

export type MaturityLevel = 'proven' | 'beta' | 'unsafe' | 'unavailable'

export type MaturityFeature =
  | 'mutation'
  | 'contract'
  | 'coverage'
  | 'architecture'
  | 'e2e'
  | 'security'
  | 'bdd'

interface MaturityEntry {
  tool: string
  maturity: MaturityLevel
  reason: string
}

/** Sparse mapping from feature → language → entry. Unknown keys return undefined. */
type MaturityMatrix = Record<string, Record<string, MaturityEntry> | undefined>

function loadMatrix(): MaturityMatrix {
  return require('../compatibility/cross-language-matrix.json') as MaturityMatrix
}

export interface MaturityResult {
  maturity: MaturityLevel
  tool: string
  reason: string
}

/**
 * Look up the maturity level for a given language × feature pair.
 * Returns `unavailable` when no entry exists in the matrix.
 *
 * Tight signatures (Language / MaturityFeature unions instead of bare string)
 * surface call-site typos at compile time — a bare string parameter previously
 * conflated "no matrix entry" with genuine typos like "kotlin" or "fuzz"
 * (#277 finding #8).
 */
export function checkMaturity(language: Language, feature: MaturityFeature): MaturityResult {
  const matrix = loadMatrix()
  const featureMap = matrix[feature]
  if (!featureMap) {
    return {
      maturity: 'unavailable',
      tool: 'N/A',
      reason: `No matrix entry for feature "${feature}"`,
    }
  }
  const entry = featureMap[language]
  if (!entry) {
    return {
      maturity: 'unavailable',
      tool: 'N/A',
      reason: `No matrix entry for language "${language}" + feature "${feature}"`,
    }
  }
  return {
    maturity: entry.maturity,
    tool: entry.tool,
    reason: entry.reason,
  }
}

export interface L3CheckResult {
  allowed: boolean
  errorMessage?: string
}

/**
 * Gate check for L3 feature generation.
 *
 * - `proven`     → always allowed
 * - `beta`       → blocked unless `acceptBetaTools === true`
 * - `unsafe`     → always blocked (even with --accept-beta-tools)
 * - `unavailable`→ always blocked
 */
export function isL3Allowed(
  language: Language,
  feature: MaturityFeature,
  acceptBetaTools: boolean,
): L3CheckResult {
  const { maturity, tool, reason } = checkMaturity(language, feature)

  switch (maturity) {
    case 'proven':
      return { allowed: true }

    case 'beta':
      if (acceptBetaTools) return { allowed: true }
      return {
        allowed: false,
        errorMessage:
          `${tool} is marked "beta" for ${language} in the cross-language matrix. ` +
          `${reason}. ` +
          `Use L2, disable ${feature} testing, or pass --accept-beta-tools to override.`,
      }

    case 'unsafe':
      return {
        allowed: false,
        errorMessage:
          `${tool} is marked "unsafe" for ${language} in the cross-language matrix. ` +
          `${reason}. ` +
          `Use L2 or disable ${feature} testing. --accept-beta-tools does not override unsafe tools.`,
      }

    case 'unavailable':
      return {
        allowed: false,
        errorMessage:
          `${feature} is marked "unavailable" for ${language} in the cross-language matrix. ` +
          `${reason}.`,
      }
  }
}
