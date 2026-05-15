// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { getTestPyramidProfile } from '../config/test-pyramid-profiles.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface TestTaxonomyResult {
  files: WriteResult[]
}

/**
 * Extract domain-specific dimensions from arbiter.json `taxonomy.domainDims[]`.
 * Returns an empty array when the config key is absent or malformed.
 */
function extractDomainDims(config: ProjectConfig): string[] {
  const raw = (config as unknown as Record<string, unknown>)['taxonomy']
  if (raw == null || typeof raw !== 'object') return []
  const dims = (raw as Record<string, unknown>)['domainDims']
  if (!Array.isArray(dims)) return []
  return dims.filter((d): d is string => typeof d === 'string')
}

/**
 * Generate docs/TEST_TAXONOMY.md for the project.
 * Pre-computes the archetype's test pyramid profile and passes it as
 * explicit template data — the EJS template never defines its own profile data.
 * T1 extension (#257): also passes domainDims and test-type code table.
 * skipIfExists: teams may want to customise the taxonomy after init.
 */
export function generateTestTaxonomy(config: ProjectConfig): TestTaxonomyResult {
  const profile = getTestPyramidProfile(config.archetype)
  const domainDims = extractDomainDims(config)
  const path = resolvedPath(config.targetDir, 'docs', 'TEST_TAXONOMY.md')
  const content = renderTemplate('root/TEST_TAXONOMY.md.ejs', {
    ...config,
    levels: profile.levels,
    hasContainerIntegration: profile.hasContainerIntegration,
    hasPropertyTests: profile.hasPropertyTests,
    hasE2ETests: profile.hasE2ETests,
    domainDims,
  })
  return {
    files: [writeFile(path, content, { skipIfExists: true })],
  }
}
