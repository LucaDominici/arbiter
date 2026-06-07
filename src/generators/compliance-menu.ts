// SPDX-License-Identifier: Apache-2.0
// #1254: compliance-menu generator — the (team × compliance) product menu.
//
// Distinct from compliance.ts (which emits COMPLIANCE_MAPPING.md, a controls→gates
// traceability table gated on the enable*Mapping booleans): this generator emits an
// always-available onboarding menu that presents every collaborationMode (team) ×
// industryOverlay (compliance) cell with its rationale, plus the
// (industryOverlay × governanceLevel) coherence guidance surfaced by `arbiter doctor`.
// It is unconditionally generated so a user can see the full decision surface before
// (re-)running init. Language-neutral: identical artefact on every stack.

import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface ComplianceMenuGeneratorResult {
  files: WriteResult[]
}

/**
 * Emit `docs/COMPLIANCE_MENU.md` — the (team × compliance) menu. Always fires
 * (onboarding aid); `skipIfExists` keeps brownfield re-init from clobbering edits.
 */
export function generateComplianceMenu(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): ComplianceMenuGeneratorResult {
  const path = resolvedPath(config.targetDir, 'docs', 'COMPLIANCE_MENU.md')
  const content = renderTemplate('compliance/compliance-menu.md.ejs', config)
  return {
    files: [writeFile(path, content, { skipIfExists: true, dryRun: opts.dryRun })],
  }
}
