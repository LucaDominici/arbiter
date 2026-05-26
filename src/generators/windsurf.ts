// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface WindsurfGeneratorResult {
  files: WriteResult[]
}

export function generateWindsurf(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): WindsurfGeneratorResult {
  const data = config
  return {
    files: [
      writeFile(
        resolvedPath(config.targetDir, 'windsurf-instructions.md'),
        renderTemplate('windsurf/windsurf-instructions.md.ejs', data),
        { backup: true, dryRun: opts.dryRun },
      ),
    ],
  }
}
