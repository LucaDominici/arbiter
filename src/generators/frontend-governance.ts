// SPDX-License-Identifier: Apache-2.0
// CATALOG: Frontend governance generator — emits FRONTEND_CONSTITUTION.md + FE_DESIGN_PRINCIPLES.md
// CATALOG: for projects with archetype frontend-spa or lanes: ["frontend"]. CANON-05 (#1124).
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface FrontendGovernanceResult {
  files: WriteResult[]
}

export function generateFrontendGovernance(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): FrontendGovernanceResult {
  const isFrontend = config.archetype === 'frontend-spa' || config.lanes.includes('frontend')
  if (!isFrontend) return { files: [] }

  // Safe-default: frontend may be absent on pre-existing frontend-spa projects.
  // Render both templates before writing either to prevent a partial-write state
  // where one file exists and the other crashes on render.
  const templateData = { ...config, frontend: config.frontend ?? {} }
  const base = config.targetDir

  const constitution = renderTemplate('frontend/FRONTEND_CONSTITUTION.md.ejs', templateData)
  const principles = renderTemplate('frontend/FE_DESIGN_PRINCIPLES.md.ejs', templateData)

  return {
    files: [
      writeFile(
        resolvedPath(base, 'docs', 'GOVERNANCE', 'FRONTEND_CONSTITUTION.md'),
        constitution,
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
      writeFile(resolvedPath(base, 'docs', 'GOVERNANCE', 'FE_DESIGN_PRINCIPLES.md'), principles, {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
    ],
  }
}
