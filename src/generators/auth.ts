// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface AuthGeneratorResult {
  files: WriteResult[]
}

export function generateAuth(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): AuthGeneratorResult {
  if (!config.auth || config.auth.provider === 'none') {
    return { files: [] }
  }
  return {
    files: [
      writeFile(
        resolvedPath(config.targetDir, 'docs', 'AUTH_SETUP.md'),
        renderTemplate('auth/setup.md.ejs', config),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    ],
  }
}
