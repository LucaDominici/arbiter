// SPDX-License-Identifier: Apache-2.0
// playwright-python generator — #366 (conftest+smoke), INV-61 + #1149 (a11y wrapper + spec).
//
// Emits the pytest-playwright conftest, smoke spec, and (for web archetypes)
// the axe-playwright-python a11y wrapper + spec stub. The a11y stack enforces
// INV-61 (WCAG 2.2 AA, critical/unclassified hard-fail) for Python frontend-spa
// and backend-web-db archetypes — mirroring the TypeScript playwright-ts generator.
//
// CLI/library/data-pipeline archetypes have no browser surface and emit nothing.
// TypeScript projects use playwright-ts.ts instead — this generator is Python-only.

import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

interface PlaywrightPythonResult {
  files: WriteResult[]
}

const E2E_ARCHETYPES = new Set(['frontend-spa', 'backend-web-db'])

export function generatePlaywrightPython(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): PlaywrightPythonResult {
  if (config.language !== 'python') {
    return { files: [] }
  }
  if (!E2E_ARCHETYPES.has(config.archetype)) {
    return { files: [] }
  }

  const base = config.targetDir
  const data = config

  const files: WriteResult[] = [
    writeFile(
      resolvedPath(base, 'tests', 'e2e', 'conftest.py'),
      renderTemplate('e2e/playwright-python/conftest.py.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    writeFile(
      resolvedPath(base, 'tests', 'e2e', 'test_smoke.py'),
      renderTemplate('e2e/playwright-python/test_smoke.py.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    // #1149 (INV-61): a11y package marker — makes `a11y` importable from
    // tests/e2e/ (pytest adds tests/e2e/ to sys.path since no __init__.py there).
    writeFile(resolvedPath(base, 'tests', 'e2e', 'a11y', '__init__.py'), '', {
      skipIfExists: true,
      dryRun: opts.dryRun,
    }),
    // #1149 (INV-61): axe-playwright-python wrapper — WCAG 2.2 AA, hard-fail on
    // critical/unclassified. Mirrors run-axe.ts threshold policy exactly.
    writeFile(
      resolvedPath(base, 'tests', 'e2e', 'a11y', 'run_axe.py'),
      renderTemplate('e2e/playwright-python/run_axe.py.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    // #1149 (INV-61): a11y spec stub — pytest parametrize over VIEWS list.
    // Collected by the existing `pytest tests/e2e` L2 gate step.
    writeFile(
      resolvedPath(base, 'tests', 'e2e', 'test_a11y.py'),
      renderTemplate('e2e/playwright-python/test_a11y.py.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  ]

  return { files }
}
