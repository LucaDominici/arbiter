// SPDX-License-Identifier: Apache-2.0
// playwright-ts generator — INV-61 (#349, CANON-05).
//
// Emits the @axe-core/playwright wrapper + a11y spec stub for TS web
// archetypes (frontend-spa, backend-web-db). Pair with the existing TS
// Playwright gate wiring in scripts/check-all.mjs.ejs (#348) — the spec
// runs under `npx playwright test` and the wrapper throws on INV-61
// violations, surfacing them as failed specs.
//
// CLI/library/data-pipeline archetypes have no browser surface and emit
// nothing.

import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

interface PlaywrightTsResult {
  files: WriteResult[]
}

const A11Y_ARCHETYPES = new Set(['frontend-spa', 'backend-web-db'])

export function generatePlaywrightTs(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): PlaywrightTsResult {
  // #1606: emit for typescript AND multi (a polyglot repo's frontend lane is TS).
  if (config.language !== 'typescript' && config.language !== 'multi') {
    return { files: [] }
  }
  if (!A11Y_ARCHETYPES.has(config.archetype)) {
    return { files: [] }
  }

  const base = config.targetDir

  return {
    files: [
      writeFile(
        resolvedPath(base, 'tests', 'e2e', 'a11y', 'run-axe.ts'),
        renderTemplate('e2e/playwright-ts/run-axe.ts.ejs', config),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
      writeFile(
        resolvedPath(base, 'tests', 'e2e', 'a11y.spec.ts'),
        renderTemplate('e2e/playwright-ts/a11y.spec.ts.ejs', config),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    ],
  }
}
