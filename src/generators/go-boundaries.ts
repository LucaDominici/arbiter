import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface GoBoundariesGeneratorResult {
  files: WriteResult[]
}

export function generateGoBoundaries(config: ProjectConfig): GoBoundariesGeneratorResult {
  if (config.language !== 'go') return { files: [] }
  if (config.architectureStyle !== 'hexagonal') return { files: [] }

  const base = config.targetDir
  const data = config as unknown as Record<string, unknown>

  return {
    files: [
      writeFile(
        resolvedPath(base, '.golangci-boundaries.yml'),
        renderTemplate('boundaries/golangci-boundaries.yml.ejs', data),
        { skipIfExists: true },
      ),
      writeFile(
        resolvedPath(base, 'scripts/check-boundaries.mjs'),
        renderTemplate('boundaries/check-boundaries-go.mjs.ejs', data),
        { skipIfExists: true },
      ),
    ],
  }
}
