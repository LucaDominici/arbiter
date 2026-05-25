// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface AiderGeneratorResult {
  files: WriteResult[]
}

export function generateAider(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): AiderGeneratorResult {
  const data = config
  return {
    files: [
      writeFile(
        resolvedPath(config.targetDir, '.aider.conf.yml'),
        renderTemplate('aider/.aider.conf.yml.ejs', data),
        { backup: true, dryRun: opts.dryRun },
      ),
    ],
  }
}
