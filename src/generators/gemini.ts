// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface GeminiGeneratorResult {
  files: WriteResult[]
}

export function generateGemini(config: ProjectConfig): GeminiGeneratorResult {
  const data = config
  return {
    files: [
      writeFile(
        resolvedPath(config.targetDir, '.gemini', 'GEMINI.md'),
        renderTemplate('gemini/GEMINI.md.ejs', data),
        { backup: true },
      ),
    ],
  }
}
