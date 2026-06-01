// SPDX-License-Identifier: Apache-2.0
/**
 * Evaluates whether a KIT catalog dimension applies to a given project config.
 *
 * Precedence (first match wins):
 *   1. excludes token match → na
 *   2. requiresDbEngine mismatch → na
 *   3. applies:[] → universal (applicable)
 *   4. applies token mismatch → na  (language:'unknown' is fail-closed)
 *   5. conditionalFlag:'spring-boot' mismatch → na  ('audit-write-services' is informational)
 *   6. → applicable
 *
 * Issue: #1043
 */

import type { KitDimension } from './schema.js'
import type { ProjectConfig } from '../wizard/types.js'

export interface ApplicabilityResult {
  applicability: 'applicable' | 'na'
  reason?: string
}

const LANGUAGE_TOKENS = new Set(['java'])

const TOKEN_ROUTER: Record<string, (c: ProjectConfig) => boolean> = {
  hexagonal: (c) => c.architectureStyle === 'hexagonal',
  spring: (c) => typeof c.framework === 'string' && c.framework.toLowerCase().includes('spring'),
  java: (c) => {
    if (c.language === 'multi') return true
    if (c.language === 'unknown') return false
    return c.language === 'java' || c.language === 'kotlin'
  },
  frontend: (c) => c.archetype === 'frontend-spa',
  fullstack: (c) => c.archetype === 'backend-web-db',
  backend: (c) => c.archetype === 'backend-web-db' || c.archetype === 'data-pipeline',
  api: (c) => c.hasPublicApi,
  cli: (c) => c.archetype === 'cli',
  embedded: (c) => c.archetype === 'embedded',
}

function matchToken(token: string, config: ProjectConfig): boolean {
  const handler = TOKEN_ROUTER[token]
  if (!handler) {
    process.stderr.write(`[applicability] unknown token '${token}' — treating as non-match\n`)
    return false
  }
  return handler(config)
}

export function evaluateApplicability(
  dim: KitDimension,
  config: ProjectConfig,
): ApplicabilityResult {
  const { applies, excludes } = dim.archetypeGating

  for (const token of excludes) {
    if (matchToken(token, config)) {
      return { applicability: 'na', reason: `excluded by token '${token}'` }
    }
  }

  if (dim.requiresDbEngine && dim.requiresDbEngine.length > 0) {
    const engine = config.databaseEngine
    if (!config.hasDatabase || !engine || !dim.requiresDbEngine.includes(engine)) {
      return { applicability: 'na', reason: 'database engine not in required set' }
    }
  }

  if (applies.length > 0) {
    const matched = applies.some((t) => matchToken(t, config))
    if (!matched) {
      const hasLanguageToken = applies.some((t) => LANGUAGE_TOKENS.has(t))
      const reason =
        config.language === 'unknown' && hasLanguageToken
          ? `language is 'unknown' — fail-closed for language-gated dimensions`
          : `no applies token matched: [${applies.join(', ')}]`
      return { applicability: 'na', reason }
    }
  }

  if (dim.conditionalFlag === 'spring-boot') {
    const hasSpring =
      typeof config.framework === 'string' && config.framework.toLowerCase().includes('spring')
    if (!hasSpring) {
      return { applicability: 'na', reason: 'spring-boot framework not configured' }
    }
  }

  return { applicability: 'applicable' }
}
