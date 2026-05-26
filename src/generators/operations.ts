// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface OperationsGeneratorResult {
  files: WriteResult[]
}

export function generateOperations(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): OperationsGeneratorResult {
  const path = resolvedPath(config.targetDir, 'docs', 'OPERATIONS_HANDBOOK.md')
  const content = renderTemplate('operations/handbook.md.ejs', config)
  return {
    files: [writeFile(path, content, { skipIfExists: true, dryRun: opts.dryRun })],
  }
}
