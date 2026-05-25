// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface CursorGeneratorResult {
  files: WriteResult[]
}

export function generateCursor(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): CursorGeneratorResult {
  const data = config
  return {
    files: [
      writeFile(
        resolvedPath(config.targetDir, '.cursorrules'),
        renderTemplate('cursor/.cursorrules.ejs', data),
        { backup: true, dryRun: opts.dryRun },
      ),
    ],
  }
}
