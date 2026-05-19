// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface EnvTemplateGeneratorResult {
  files: WriteResult[]
}

export function generateEnvTemplate(config: ProjectConfig): EnvTemplateGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir
  const data = { projectName: config.projectName }

  const envExamplePath = resolvedPath(base, '.env.example')
  results.push(
    writeFile(envExamplePath, renderTemplate('local-wrapper/.env.example.ejs', data), {
      skipIfExists: true,
    }),
  )

  return { files: results }
}
