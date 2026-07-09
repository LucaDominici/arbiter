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
import { formatContent } from '../utils/prettier-format.js'
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

  // #1840 F4 tranche-3: formatContent (#933 F13) reformats these hand-authored
  // (single-quote/no-semi) templates to the TARGET project's own .prettierrc
  // before writing — see api-middleware.ts for the same fix + rationale.
  const runAxePath = resolvedPath(base, 'tests', 'e2e', 'a11y', 'run-axe.ts')
  const a11ySpecPath = resolvedPath(base, 'tests', 'e2e', 'a11y.spec.ts')

  return {
    files: [
      writeFile(
        runAxePath,
        formatContent(renderTemplate('e2e/playwright-ts/run-axe.ts.ejs', config), runAxePath, base),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
      writeFile(
        a11ySpecPath,
        formatContent(
          renderTemplate('e2e/playwright-ts/a11y.spec.ts.ejs', config),
          a11ySpecPath,
          base,
        ),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    ],
  }
}
