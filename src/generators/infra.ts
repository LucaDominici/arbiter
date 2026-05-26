// SPDX-License-Identifier: Apache-2.0
// F11: Azure ContainerApp infra template generator (#893)
// Emits infra/azure/containerapp.tpl.yaml when enableAzureContainerApp is true.
// Gate: config.enableAzureContainerApp === true (default off — opt-in per downstream project).
//
// Existing Code Survey (CANON-16):
//   - grep "export function generate" src/generators/*.ts — no existing infra generator found.
//   - src/templates/infra/ did not exist before this task.
//   - New file justified: distinct domain (cloud infra YAML) vs github.ts (GH workflow YAML).

import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface InfraGeneratorResult {
  files: WriteResult[]
}

/**
 * Generate Azure ContainerApp infra template.
 *
 * Emits one file when enableAzureContainerApp is true:
 *   infra/azure/containerapp.tpl.yaml  — envsubst deploy template (skipIfExists)
 *
 * The skipIfExists flag ensures user-customized deploy specs survive re-init.
 */
export function generateInfra(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): InfraGeneratorResult {
  if (!config.enableAzureContainerApp) return { files: [] }

  const infraDir = resolvedPath(config.targetDir, 'infra', 'azure')

  const files: WriteResult[] = [
    writeFile(
      join(infraDir, 'containerapp.tpl.yaml'),
      renderTemplate('infra/azure/containerapp.tpl.yaml.ejs', config),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  ]

  return { files }
}
