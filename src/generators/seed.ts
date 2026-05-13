import { chmodSync } from 'node:fs'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

interface SeedGeneratorResult {
  files: WriteResult[]
}

const SCRIPT_MODE = 0o755

export function generateSeed(config: ProjectConfig): SeedGeneratorResult {
  if (config.archetype !== 'backend-web-db' || config.governanceLevel === 'L1') {
    return { files: [] }
  }

  const base = config.targetDir
  const data = config as unknown as Record<string, unknown>

  const seedScriptPath = resolvedPath(base, 'scripts', 'seed-test-data.sh')
  const commonLibPath = resolvedPath(base, 'scripts', 'lib', 'seed-common.sh')

  const seedResult = writeFile(
    seedScriptPath,
    renderTemplate('scripts/seed-test-data.sh.ejs', data),
    { skipIfExists: true },
  )

  if (seedResult.action !== 'skipped') {
    chmodSync(seedScriptPath, SCRIPT_MODE)
  }

  const commonResult = writeFile(
    commonLibPath,
    renderTemplate('scripts/lib/seed-common.sh.ejs', data),
    { skipIfExists: true },
  )

  return { files: [seedResult, commonResult] }
}
