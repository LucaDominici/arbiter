// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface CiTierGeneratorResult {
  files: WriteResult[]
}

// Emits the 4 supplementary CI-tier artifacts (reusable workflow + label infra).
// Standard numbered CI workflows (01–09) remain owned by github.ts with ciTierMode awareness.
export function generateCiTier(config: ProjectConfig): CiTierGeneratorResult {
  if (!config.useGitHub) return { files: [] }

  const data = config
  const githubDir = resolvedPath(config.targetDir, '.github')
  const workflowsDir = join(githubDir, 'workflows')
  const actionsDir = join(githubDir, 'actions')

  const files: WriteResult[] = [
    writeFile(
      join(workflowsDir, '_notify.yml'),
      renderTemplate('github/workflows/_notify.yml.ejs', data),
    ),
    writeFile(
      join(workflowsDir, '_label-sync.yml'),
      renderTemplate('github/workflows/_label-sync.yml.ejs', data),
    ),
    writeFile(join(githubDir, 'labels.yml'), renderTemplate('github/labels.yml.ejs', data)),
    writeFile(
      join(actionsDir, 'setup-node-pnpm', 'action.yml'),
      renderTemplate('github/actions/setup-node-pnpm/action.yml.ejs', data),
    ),
  ]

  // #943: opt-in post-merge CODEOWNERS email notification (L2+ only).
  // Requires MAIL_SERVER/MAIL_USERNAME/MAIL_PASSWORD secrets and MAIL_DOMAIN_ALLOWLIST var.
  if (config.governanceLevel !== 'L1' && config.enableCodeownersNotify === true) {
    files.push(
      writeFile(
        join(workflowsDir, '_post-merge-notify.yml'),
        renderTemplate('github/workflows/_post-merge-notify.yml.ejs', data),
      ),
    )
  }

  return { files }
}
