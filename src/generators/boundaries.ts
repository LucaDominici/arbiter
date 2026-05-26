// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface BoundariesGeneratorResult {
  files: WriteResult[]
}

export function generateEslintBoundaries(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): BoundariesGeneratorResult {
  if (config.language !== 'typescript' && config.language !== 'multi') return { files: [] }

  const base = config.targetDir
  const data = config

  if (config.archetype === 'frontend-spa') {
    return {
      files: [
        writeFile(
          resolvedPath(base, '.eslintrc-frontend-spa.cjs'),
          renderTemplate('boundaries/.eslintrc-frontend-spa.cjs.ejs', data),
          { skipIfExists: true, dryRun: opts.dryRun },
        ),
      ],
    }
  }

  if (config.architectureStyle !== 'hexagonal') return { files: [] }

  return {
    files: [
      writeFile(
        resolvedPath(base, '.eslintrc-boundaries.cjs'),
        renderTemplate('boundaries/.eslintrc-boundaries.cjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
      writeFile(
        resolvedPath(base, 'scripts/check-boundaries.mjs'),
        renderTemplate('boundaries/check-boundaries.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    ],
  }
}
