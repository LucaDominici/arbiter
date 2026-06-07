// SPDX-License-Identifier: Apache-2.0
// #1251: GDPR industry-overlay generator — controls→gates (real, enforceable).
//
// The legacy gdpr path (pharma.ts → generateGenericAudit) emitted docs only.
// This generator adds the GDPR-specific, ENFORCEABLE layer:
//   - scripts/check-gdpr-controls.mjs — a real gate that fails (exit 1) when any
//     required GDPR control artifact is missing or malformed.
//   - docs/compliance/gdpr/dpia.md — Data Protection Impact Assessment (Art. 35).
//   - docs/compliance/gdpr/data-flow-map.md — personal-data flow inventory.
//   - docs/compliance/gdpr/controls-to-gates.md — controls→gate traceability.
//
// Composed (not replacing) the generic audit docs in pharma.ts's gdpr branch.
// Wired into the generated project's L2 gate via check-all.mjs.ejs (existsSync-
// guarded runCheck), so a generated gdpr project has an enforceable gate.

import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

/**
 * Emit the GDPR controls→gates overlay. Returns the written files (skipIfExists,
 * brownfield-safe). Only meaningful when `industryOverlay === 'gdpr'`; the caller
 * (generatePharma) guards on that, so this is unconditional once reached.
 */
export function generateGdprControls(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): WriteResult[] {
  const base = config.targetDir
  const data = config
  const skip = { skipIfExists: true, dryRun: opts.dryRun } as const
  const docsDir = 'docs/compliance/gdpr'

  return [
    writeFile(
      resolvedPath(base, 'scripts', 'check-gdpr-controls.mjs'),
      renderTemplate('audit/gdpr/check-gdpr-controls.mjs.ejs', data),
      skip,
    ),
    writeFile(
      resolvedPath(base, docsDir, 'dpia.md'),
      renderTemplate('audit/gdpr/dpia.md.ejs', data),
      skip,
    ),
    writeFile(
      resolvedPath(base, docsDir, 'data-flow-map.md'),
      renderTemplate('audit/gdpr/data-flow-map.md.ejs', data),
      skip,
    ),
    writeFile(
      resolvedPath(base, docsDir, 'controls-to-gates.md'),
      renderTemplate('audit/gdpr/controls-to-gates.md.ejs', data),
      skip,
    ),
  ]
}
