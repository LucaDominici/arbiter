// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { injectDevDependency } from '../utils/pkg.js'
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
    // The gate runs the flat config (ESLint v9 removed the legacy --no-eslintrc/-c
    // loader the .cjs file needs — #1491-class fix, mirrors eslint.config.static.mjs).
    // eslint-plugin-boundaries is what the flat config's rules resolve against —
    // inject it so a fresh init does not RED on `Cannot find package` (#1835-class
    // fix, mirrors the Java BDD dep injection in behavioral-tests.ts).
    injectDevDependency(base, 'eslint-plugin-boundaries', '^7.0.2', opts.dryRun)
    return {
      files: [
        writeFile(
          resolvedPath(base, '.eslintrc-frontend-spa.cjs'),
          renderTemplate('boundaries/.eslintrc-frontend-spa.cjs.ejs', data),
          { skipIfExists: true, dryRun: opts.dryRun },
        ),
        writeFile(
          resolvedPath(base, 'eslint.config.frontend-spa.mjs'),
          renderTemplate('boundaries/eslint.config.frontend-spa.mjs.ejs', data),
          { skipIfExists: true, dryRun: opts.dryRun },
        ),
      ],
    }
  }

  if (config.architectureStyle !== 'hexagonal') return { files: [] }

  // #2272: the gate runs the flat config (ESLint v9 removed the legacy
  // --no-eslintrc/-c loader the .cjs file needs — #1491-class fix, mirrors the
  // frontend-spa fix above). eslint-plugin-boundaries is what the flat config's
  // rules resolve against — inject it so a fresh init does not RED on
  // `Cannot find package` (#1835-class fix).
  injectDevDependency(base, 'eslint-plugin-boundaries', '^7.0.2', opts.dryRun)
  return {
    files: [
      writeFile(
        resolvedPath(base, '.eslintrc-boundaries.cjs'),
        renderTemplate('boundaries/.eslintrc-boundaries.cjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
      writeFile(
        resolvedPath(base, 'eslint.config.boundaries.mjs'),
        renderTemplate('boundaries/eslint.config.boundaries.mjs.ejs', data),
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
