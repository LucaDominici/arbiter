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
  if (!config.useGitHub) {
    return { files: [] }
  }

  const base = config.targetDir
  const data = config
  const files: WriteResult[] = []

  if (config.governanceLevel !== 'L1') {
    const setupScript = resolvedPath(base, 'scripts', 'setup-repo.sh')
    const result = writeFile(setupScript, renderTemplate('scripts/setup-repo.sh.ejs', data), {
      skipIfExists: true,
    })
    if (result.action !== 'skipped') {
      chmodSync(setupScript, SCRIPT_MODE)
    }
    files.push(result)
  }

  const bpScript = resolvedPath(base, 'scripts', 'apply-branch-protection.mjs')
  const bpResult = writeFile(
    bpScript,
    renderTemplate('scripts/apply-branch-protection.mjs.ejs', data),
  )
  if (bpResult.action !== 'skipped') {
    chmodSync(bpScript, SCRIPT_MODE)
  }
  files.push(bpResult)

  return { files }
}
