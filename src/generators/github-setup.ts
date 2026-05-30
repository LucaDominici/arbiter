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

export function generateGithubSetup(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): GithubSetupGeneratorResult {
  if (!(config.permitGitHub ?? config.useGitHub)) {
    return { files: [] }
  }

  const base = config.targetDir
  const data = config
  const files: WriteResult[] = []

  if (config.governanceLevel !== 'L1') {
    const setupScript = resolvedPath(base, 'scripts', 'setup-repo.sh')
    const result = writeFile(setupScript, renderTemplate('scripts/setup-repo.sh.ejs', data), {
      skipIfExists: true,
      dryRun: opts.dryRun,
    })
    if (!opts.dryRun && result.action !== 'skipped') {
      chmodSync(setupScript, SCRIPT_MODE)
    }
    files.push(result)
  }

  const bpScript = resolvedPath(base, 'scripts', 'apply-branch-protection.mjs')
  const bpResult = writeFile(
    bpScript,
    renderTemplate('scripts/apply-branch-protection.mjs.ejs', data),
    { dryRun: opts.dryRun },
  )
  if (!opts.dryRun && bpResult.action !== 'skipped') {
    chmodSync(bpScript, SCRIPT_MODE)
  }
  files.push(bpResult)

  for (const name of [
    'check-ci-tiers.mjs',
    'check-action-pins.mjs',
    'check-workflow-perms.mjs',
    'check-merge-method.mjs',
  ] as const) {
    const scriptPath = resolvedPath(base, 'scripts', name)
    const result = writeFile(scriptPath, renderTemplate(`scripts/${name}.ejs`, data), {
      dryRun: opts.dryRun,
    })
    if (!opts.dryRun && result.action !== 'skipped') {
      chmodSync(scriptPath, SCRIPT_MODE)
    }
    files.push(result)
  }

  return { files }
}
