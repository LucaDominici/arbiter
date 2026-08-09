// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig, InvariantTier } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'
import { getFilteredInvariants, getInvariantsByTier } from '../invariants/filter.js'
import { TIER_LABELS } from '../invariants/tiers.js'

const OPTIONAL_TIERS: InvariantTier[] = ['data', 'security', 'operational']

export function generateGlobalInvariants(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): WriteResult {
  const hasOptionalTiers = config.invariantTiers.some((t) => OPTIONAL_TIERS.includes(t))

  if (!hasOptionalTiers) {
    // Deliberate non-emission: GLOBAL_INVARIANTS.md only ships when an optional
    // tier (data/security/operational) is selected — at L1's `essential` preset
    // there are none, so the file SHOULD NOT exist. Mark it `not-applicable` so
    // init reporting does not falsely claim it "already exists" on a clean project
    // and the post-write presence check does not flag it as a lost file (M1/#1491).
    return {
      action: 'skipped',
      reason: 'not-applicable',
      path: resolvedPath(config.targetDir, 'GLOBAL_INVARIANTS.md'),
    }
  }

  const invariants = getFilteredInvariants({
    language: config.language,
    governanceLevel: config.governanceLevel,
    invariantTiers: config.invariantTiers,
    ...(config.includeExtendedInvariants ? { includeExtendedInvariants: true } : {}),
    ...(config.projectInvariants !== undefined
      ? { projectInvariants: config.projectInvariants }
      : {}),
  })
  const invariantsByTier = getInvariantsByTier(invariants)

  const data = {
    ...config,
    invariants,
    invariantsByTier,
    tierLabels: TIER_LABELS,
  }

  const content =
    renderTemplate('global-invariants/GLOBAL_INVARIANTS.md.ejs', data).trimEnd() + '\n'
  return writeFile(resolvedPath(config.targetDir, 'GLOBAL_INVARIANTS.md'), content, {
    backup: true,
    dryRun: opts.dryRun,
  })
}
