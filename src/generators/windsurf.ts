import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface WindsurfGeneratorResult {
  files: WriteResult[]
}

export function generateWindsurf(config: ProjectConfig): WindsurfGeneratorResult {
  const data = config as unknown as Record<string, unknown>
  return {
    files: [
      writeFile(
        resolvedPath(config.targetDir, 'windsurf-instructions.md'),
        renderTemplate('windsurf/windsurf-instructions.md.ejs', data),
        { backup: true },
      ),
    ],
  }
}
