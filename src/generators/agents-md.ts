// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'
import { getFilteredInvariants, getInvariantsByTier } from '../invariants/filter.js'
import { TIER_LABELS } from '../invariants/tiers.js'
import type { InstalledSkill, SkipReport } from '../integrations/types.js'

export function generateAgentsMd(
  config: ProjectConfig,
  installedSkills: InstalledSkill[] = [],
  skippedGenerators: SkipReport[] = [],
): WriteResult {
  const invariants = getFilteredInvariants({
    language: config.language,
    governanceLevel: config.governanceLevel,
    invariantTiers: config.invariantTiers,
    ...(config.includeExtendedInvariants ? { includeExtendedInvariants: true } : {}),
  })
  const invariantsByTier = getInvariantsByTier(invariants)

  const data = {
    ...config,
    invariants,
    invariantsByTier,
    tierLabels: TIER_LABELS,
    installedSkills,
    skippedGenerators,
  }

  const content = renderTemplate('agents-md/AGENTS.md.ejs', data)
  return writeFile(resolvedPath(config.targetDir, 'AGENTS.md'), content, {
    backup: true,
  })
}
