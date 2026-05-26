// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface CopilotGeneratorResult {
  files: WriteResult[]
}

export function generateCopilot(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): CopilotGeneratorResult {
  const data = config
  return {
    files: [
      writeFile(
        resolvedPath(config.targetDir, '.github', 'copilot-instructions.md'),
        renderTemplate('copilot/copilot-instructions.md.ejs', data),
        { backup: true, dryRun: opts.dryRun },
      ),
    ],
  }
}
