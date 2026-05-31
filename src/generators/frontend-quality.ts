// SPDX-License-Identifier: Apache-2.0
// CATALOG: Frontend quality enforcement generator — emits mechanical gate scripts
// CATALOG: (tokens, i18n, coverage, VRT, perf) for frontend-spa and frontend-lane
// CATALOG: projects. Companion to frontend-governance.ts (which emits docs). (#1127)
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface FrontendQualityResult {
  files: WriteResult[]
}

export function generateFrontendQuality(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): FrontendQualityResult {
  const isFrontend = config.archetype === 'frontend-spa' || config.lanes.includes('frontend')
  if (!isFrontend) return { files: [] }

  const base = config.targetDir
  // Safe-default: frontend may be absent on pre-existing frontend-spa projects.
  const templateData = { ...config, frontend: config.frontend ?? {} }

  // Render all templates before writing to avoid partial-write state.
  const tokensDef = renderTemplate('frontend/design-tokens.json.ejs', templateData)
  const verifyTokens = renderTemplate('scripts/verify-tokens.mjs.ejs', templateData)
  const i18nScanner = renderTemplate('scripts/i18n-literal-scanner.mjs.ejs', templateData)
  const i18nParity = renderTemplate('scripts/verify-i18n-parity.mjs.ejs', templateData)

  return {
    files: [
      // Design tokens (W3C DTCG format) — INV-105 seed file
      writeFile(resolvedPath(base, 'design-tokens.json'), tokensDef, {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
      // Token discipline gate script — INV-105 enforcement
      writeFile(resolvedPath(base, 'scripts', 'verify-tokens.mjs'), verifyTokens, {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
      // i18n raw-literal scanner — INV-106 enforcement
      writeFile(resolvedPath(base, 'scripts', 'i18n-literal-scanner.mjs'), i18nScanner, {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
      // i18n locale key-parity gate — INV-106 enforcement
      writeFile(resolvedPath(base, 'scripts', 'verify-i18n-parity.mjs'), i18nParity, {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
    ],
  }
}
