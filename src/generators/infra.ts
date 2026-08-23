// SPDX-License-Identifier: Apache-2.0
// F11: Azure ContainerApp infra template generator (#893)
// Emits infra/azure/containerapp.tpl.yaml when deployTarget === 'azure-container-app'.
// Gate: config.deployTarget === 'azure-container-app' (default off — opt-in per downstream project).
//
// Existing Code Survey (CANON-16):
//   - grep "export function generate" src/generators/*.ts — no existing infra generator found.
//   - src/templates/infra/ did not exist before this task.
//   - New file justified: distinct domain (cloud infra YAML) vs github.ts (GH workflow YAML).

import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { chmodTranslated, writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface InfraGeneratorResult {
  files: WriteResult[]
}

const SCRIPT_MODE = 0o755

/**
 * Generate deployTarget-specific infra scaffolding.
 *
 * Emits one file when deployTarget === 'azure-container-app':
 *   infra/azure/containerapp.tpl.yaml  — envsubst deploy template (skipIfExists)
 *
 * Emits one file when deployTarget === 'nas-compose':
 *   infra/nas-compose/deploy.sh  — pull-by-digest, compose-lifecycle deploy script
 *   (skipIfExists, chmod 755), invoked by `_deploy/nas-compose.ejs`.
 *
 * The skipIfExists flag ensures user-customized deploy specs survive re-init.
 */
export function generateInfra(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): InfraGeneratorResult {
  if (config.deployTarget === 'azure-container-app') {
    const infraDir = resolvedPath(config.targetDir, 'infra', 'azure')
    return {
      files: [
        writeFile(
          join(infraDir, 'containerapp.tpl.yaml'),
          renderTemplate('infra/azure/containerapp.tpl.yaml.ejs', config),
          { skipIfExists: true, dryRun: opts.dryRun },
        ),
      ],
    }
  }

  if (config.deployTarget === 'nas-compose') {
    const infraDir = resolvedPath(config.targetDir, 'infra', 'nas-compose')
    const scriptPath = join(infraDir, 'deploy.sh')
    const scriptResult = writeFile(
      scriptPath,
      renderTemplate('infra/nas-compose/deploy.sh.ejs', config),
      { skipIfExists: true, dryRun: opts.dryRun },
    )
    if (!opts.dryRun && scriptResult.action !== 'skipped') {
      chmodTranslated(scriptPath, SCRIPT_MODE)
    }
    return { files: [scriptResult] }
  }

  return { files: [] }
}
