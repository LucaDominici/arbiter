// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface BoundariesGeneratorResult {
  files: WriteResult[]
}

export function generatePythonBoundaries(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): BoundariesGeneratorResult {
  if (config.language !== 'python') return { files: [] }
  if (config.architectureStyle !== 'hexagonal') return { files: [] }

  const base = config.targetDir
  const data = config

  return {
    files: [
      writeFile(
        resolvedPath(base, '.importlinter'),
        renderTemplate('boundaries/.importlinter.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
      writeFile(
        resolvedPath(base, 'ruff-boundaries.toml'),
        renderTemplate('boundaries/ruff-boundaries.toml.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
      writeFile(
        resolvedPath(base, 'scripts/check-boundaries.mjs'),
        renderTemplate('boundaries/check-boundaries-python.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    ],
  }
}
