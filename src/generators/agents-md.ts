// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'
import { getFilteredInvariants, getInvariantsByTier } from '../invariants/filter.js'
import { TIER_LABELS } from '../invariants/tiers.js'
import type { InstalledSkill, SkipReport } from '../integrations/types.js'

/**
 * Render AGENTS.md content for the given config without writing it. Extracted
 * (#2040) so `arbiter diff --governance` can compare the CURRENT template's
 * rendered content against a materialized file without duplicating the
 * invariant-filtering/tier-grouping logic.
 */
export function renderAgentsMd(
  config: ProjectConfig,
  installedSkills: InstalledSkill[] = [],
  skippedGenerators: SkipReport[] = [],
): string {
  const invariants = getFilteredInvariants({
    language: config.language,
    governanceLevel: config.governanceLevel,
    invariantTiers: config.invariantTiers,
    ...(config.includeExtendedInvariants ? { includeExtendedInvariants: true } : {}),
    ...(config.projectInvariants !== undefined ? { projectInvariants: config.projectInvariants } : {}),
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

  return renderTemplate('agents-md/AGENTS.md.ejs', data)
}

export function generateAgentsMd(
  config: ProjectConfig,
  installedSkills: InstalledSkill[] = [],
  skippedGenerators: SkipReport[] = [],
  opts: { dryRun: boolean } = { dryRun: false },
): WriteResult {
  const content = renderAgentsMd(config, installedSkills, skippedGenerators)
  return writeFile(resolvedPath(config.targetDir, 'AGENTS.md'), content, {
    backup: true,
    dryRun: opts.dryRun,
  })
}
