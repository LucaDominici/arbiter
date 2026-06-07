// SPDX-License-Identifier: Apache-2.0
// #1252: ISO 27001:2022 Annex-A overlay generator.
// industryOverlay === 'iso27001' → emit a controls→gate traceability doc binding
//   the issue-named Annex-A technological controls (A.8.25/26/28/29/32 +
//   access-control + SBOM/supply-chain) to existing fail-closed arbiter gates.
// Language-neutral (no framework scaffolding). Stackable as an orthogonal enum
// value alongside pharma / sox / gdpr / iso9001.
// Note: the generic audit-trail docs are emitted by the `pharma` registry spec
//   (gate: industryOverlay != 'none'); this generator adds ONLY the ISO-specific
//   traceability doc — no duplicate audit-doc emission.

import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface Iso27001GeneratorResult {
  files: WriteResult[]
}

/**
 * Emit the ISO 27001:2022 Annex-A controls→gate traceability overlay.
 *
 * Fires only when `industryOverlay === 'iso27001'`. Emits a single
 * language-neutral traceability document under `docs/compliance/` that maps the
 * issue-named Annex-A controls to the concrete, fail-closed arbiter gates which
 * satisfy them. skipIfExists so re-init preserves auditor edits.
 */
export function generateIso27001(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): Iso27001GeneratorResult {
  if (config.industryOverlay !== 'iso27001') {
    return { files: [] }
  }

  const skip = { skipIfExists: true, dryRun: opts.dryRun } as const

  return {
    files: [
      writeFile(
        resolvedPath(config.targetDir, 'docs/compliance', 'iso27001-controls-gate-map.md'),
        renderTemplate('audit/iso27001/iso27001-controls-gate-map.md.ejs', config),
        skip,
      ),
    ],
  }
}
