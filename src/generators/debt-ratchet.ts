// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig, MetricsProfile } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export type { DebtBaselineV2 } from '../types/debt-baseline.js'

export interface DebtRatchetGeneratorResult {
  files: WriteResult[]
}

export function computeMetricsProfile(config: ProjectConfig): MetricsProfile {
  return {
    includeBundleSize: config.archetype === 'frontend-spa' && config.language === 'typescript',
    includePublicApiSurface: config.archetype === 'library' && config.language === 'typescript',
    includeBranchCoverage: config.archetype === 'backend-web-db' || config.archetype === 'library',
    spotbugsEnabled: config.language === 'java' || config.language === 'multi',
    archunitEnabled:
      (config.language === 'java' || config.language === 'multi') &&
      config.architectureStyle !== 'none',
  }
}

export function generateDebtRatchet(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): DebtRatchetGeneratorResult {
  if (!config.enableDebtGates) return { files: [] }

  const base = config.targetDir
  const metricsProfile = computeMetricsProfile(config)
  const data = {
    ...config,
    metricsProfile,
  }

  return {
    files: [
      writeFile(
        resolvedPath(base, 'scripts', 'debt-lib.mjs'),
        renderTemplate('scripts/debt-lib.mjs.ejs', data),
        { skipIfExists: false, backup: true, dryRun: opts.dryRun },
      ),
      writeFile(
        resolvedPath(base, 'scripts', 'capture-debt-baseline.mjs'),
        renderTemplate('scripts/capture-debt-baseline.mjs.ejs', data),
        { skipIfExists: false, backup: true, dryRun: opts.dryRun },
      ),
      writeFile(
        resolvedPath(base, 'scripts', 'debt-report.mjs'),
        renderTemplate('scripts/debt-report.mjs.ejs', data),
        { skipIfExists: false, backup: true, dryRun: opts.dryRun },
      ),
    ],
  }
}
