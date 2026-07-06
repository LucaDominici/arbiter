// SPDX-License-Identifier: Apache-2.0
// CATALOG: E2E constitution generator — emits E2E_CONSTITUTION.md (installable, ~10-rule
// CATALOG: determinism standard) for projects with a Playwright E2E harness. #1817 (A4).
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface E2eConstitutionResult {
  files: WriteResult[]
}

/**
 * #1817 (A4): install the E2E constitution wherever an E2E (Playwright) harness is
 * installed — same applicability as `playwright-ts` / `playwright-python` combined
 * (frontend-spa or backend-web-db), independent of language, since the determinism
 * rules are stack-agnostic (INV-130's "stack-agnostic E2E reliability subsystem").
 * `skipIfExists: true` makes the installed file customizable — arbiter never
 * overwrites a user's edits on re-run (same contract as frontend-governance.ts).
 */
export function generateE2eConstitution(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): E2eConstitutionResult {
  const hasE2eHarness = config.archetype === 'frontend-spa' || config.archetype === 'backend-web-db'
  if (!hasE2eHarness) return { files: [] }

  const constitution = renderTemplate('e2e/E2E_CONSTITUTION.md.ejs', config)
  const base = config.targetDir

  return {
    files: [
      writeFile(resolvedPath(base, 'docs', 'GOVERNANCE', 'E2E_CONSTITUTION.md'), constitution, {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
    ],
  }
}
