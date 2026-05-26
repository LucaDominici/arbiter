// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface ObservabilityGeneratorResult {
  files: WriteResult[]
}

export function generateObservability(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): ObservabilityGeneratorResult {
  if (!config.observability || config.observability.provider === 'none') {
    return { files: [] }
  }
  return {
    files: [
      writeFile(
        resolvedPath(config.targetDir, 'docs', 'OBSERVABILITY.md'),
        renderTemplate('observability/setup.md.ejs', config),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    ],
  }
}
