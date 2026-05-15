// SPDX-License-Identifier: Apache-2.0
import { chmodSync } from 'node:fs'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface GithubSetupGeneratorResult {
  files: WriteResult[]
}

const SCRIPT_MODE = 0o755

export function generateGithubSetup(config: ProjectConfig): GithubSetupGeneratorResult {
  if (!config.useGitHub || config.governanceLevel === 'L1') {
    return { files: [] }
  }

  const base = config.targetDir
  const data = config
  const scriptPath = resolvedPath(base, 'scripts', 'setup-repo.sh')

  const result = writeFile(scriptPath, renderTemplate('scripts/setup-repo.sh.ejs', data), {
    skipIfExists: true,
  })

  if (result.action !== 'skipped') {
    chmodSync(scriptPath, SCRIPT_MODE)
  }

  return { files: [result] }
}
