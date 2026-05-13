import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface SelfValidationGeneratorResult {
  files: WriteResult[]
}

export function generateSelfValidation(config: ProjectConfig): SelfValidationGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir

  const scriptPath = resolvedPath(base, 'scripts', 'self-validation.mjs')
  results.push(
    writeFile(
      scriptPath,
      renderTemplate(
        'scripts/self-validation.mjs.ejs',
        config as unknown as Record<string, unknown>,
      ),
      { skipIfExists: true },
    ),
  )

  const exitContractPath = resolvedPath(base, 'scripts', 'check-exit-code-contract.mjs')
  results.push(
    writeFile(
      exitContractPath,
      renderTemplate(
        'scripts/check-exit-code-contract.mjs.ejs',
        config as unknown as Record<string, unknown>,
      ),
      { skipIfExists: true },
    ),
  )

  const pipeTeeHazardPath = resolvedPath(base, 'scripts', 'check-pipe-tee-hazard.mjs')
  results.push(
    writeFile(
      pipeTeeHazardPath,
      renderTemplate(
        'scripts/check-pipe-tee-hazard.mjs.ejs',
        config as unknown as Record<string, unknown>,
      ),
      { skipIfExists: true },
    ),
  )

  return { files: results }
}
