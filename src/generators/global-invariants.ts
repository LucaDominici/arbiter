// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig, InvariantTier } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'
import { getFilteredInvariants, getInvariantsByTier } from '../invariants/filter.js'
import { TIER_LABELS } from '../invariants/tiers.js'

const OPTIONAL_TIERS: InvariantTier[] = ['data', 'security', 'operational']

export function generateGlobalInvariants(config: ProjectConfig): WriteResult {
  const hasOptionalTiers = config.invariantTiers.some((t) => OPTIONAL_TIERS.includes(t))

  if (!hasOptionalTiers) {
    return {
      action: 'skipped',
      path: resolvedPath(config.targetDir, 'GLOBAL_INVARIANTS.md'),
    }
  }

  const invariants = getFilteredInvariants({
    language: config.language,
    governanceLevel: config.governanceLevel,
    invariantTiers: config.invariantTiers,
    ...(config.includeViaferaPort ? { includeViaferaPort: true } : {}),
  })
  const invariantsByTier = getInvariantsByTier(invariants)

  const data = {
    ...config,
    invariants,
    invariantsByTier,
    tierLabels: TIER_LABELS,
  }

  const content = renderTemplate('global-invariants/GLOBAL_INVARIANTS.md.ejs', data)
  return writeFile(resolvedPath(config.targetDir, 'GLOBAL_INVARIANTS.md'), content, {
    backup: true,
  })
}
