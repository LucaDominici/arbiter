// SPDX-License-Identifier: Apache-2.0
// CANON-22: duplication (DRY) gate generator. Emits a jscpd config + the
// fail-closed check-duplication.mjs gate script + injects the jscpd devDep so
// the duplication gate wired into the generated check-all is not
// dead-on-arrival (CANON-01: arbiter dogfoods the same gate at scripts/check-all.mjs).
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { injectDevDependency } from '../utils/pkg.js'
import type { GovernanceLevel, ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface DuplicationGeneratorResult {
  files: WriteResult[]
}

/**
 * Duplication ceiling (% duplicated tokens) by governance level. The ratchet
 * tightens beyond this; the ceiling is the absolute fail line for a fresh repo.
 */
function duplicationThresholdFor(level: GovernanceLevel): number {
  if (level === 'L1') return 10
  if (level === 'L2') return 5
  return 3 // L3 / L4 — strict
}

export function generateDuplication(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): DuplicationGeneratorResult {
  // jscpd is a TS/JS clone detector. TypeScript only: the generated check-all
  // duplication step is rendered inside the `language === 'typescript'` L2 block,
  // so emitting config for other stacks (incl. `multi`) would be dead-on-arrival.
  // Other stacks get duplication via native tooling (PMD-CPD for Java, etc.).
  if (config.language !== 'typescript') return { files: [] }
  if (!config.enableDebtGates) return { files: [] }

  const data = {
    ...config,
    duplicationThreshold: duplicationThresholdFor(config.governanceLevel),
  }

  const files: WriteResult[] = [
    writeFile(
      resolvedPath(config.targetDir, '.jscpd.json'),
      renderTemplate('static-analysis/jscpd.json.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    // Fail-closed gate wrapper: jscpd v5 exits 0 on a 0-file scan, so the
    // generated check-all routes duplication through this script instead of a
    // bare `npx jscpd` (#1286). Force-regenerated — arbiter-owned script.
    writeFile(
      resolvedPath(config.targetDir, 'scripts/check-duplication.mjs'),
      renderTemplate('scripts/check-duplication.mjs.ejs', data),
      { skipIfExists: false, dryRun: opts.dryRun },
    ),
  ]

  // Exact pin: v5 is a Rust-binary rewrite shipped via platform
  // optionalDependencies; a floating range would let unreviewed behavior
  // drift into the governed project's gate (#1286).
  injectDevDependency(config.targetDir, 'jscpd', '5.0.6', opts.dryRun)

  return { files }
}
