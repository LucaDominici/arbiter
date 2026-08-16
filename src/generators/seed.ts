// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { chmodTranslated, resolvedPath, writeFile } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

interface SeedGeneratorResult {
  files: WriteResult[]
}

const SCRIPT_MODE = 0o755

export function generateSeed(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): SeedGeneratorResult {
  if (config.archetype !== 'backend-web-db' || config.governanceLevel === 'L1') {
    return { files: [] }
  }

  const base = config.targetDir
  const data = config

  const seedScriptPath = resolvedPath(base, 'scripts', 'seed-test-data.sh')
  const commonLibPath = resolvedPath(base, 'scripts', 'lib', 'seed-common.sh')

  const seedResult = writeFile(
    seedScriptPath,
    renderTemplate('scripts/seed-test-data.sh.ejs', data),
    { skipIfExists: true, dryRun: opts.dryRun },
  )

  if (!opts.dryRun && seedResult.action !== 'skipped') {
    chmodTranslated(seedScriptPath, SCRIPT_MODE)
  }

  const commonResult = writeFile(
    commonLibPath,
    renderTemplate('scripts/lib/seed-common.sh.ejs', data),
    { skipIfExists: true, dryRun: opts.dryRun },
  )

  return { files: [seedResult, commonResult] }
}
