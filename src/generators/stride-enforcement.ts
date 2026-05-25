// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface StrideEnforcementResult {
  files: WriteResult[]
}

export function generateStrideEnforcement(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): StrideEnforcementResult {
  if (config.governanceLevel === 'L1') return { files: [] }

  const base = config.targetDir
  const data = config

  const results: WriteResult[] = [
    // User-edited governance docs — skip on regeneration to preserve threat entries
    writeFile(
      resolvedPath(base, 'docs', 'SECURITY', 'STRIDE.md'),
      renderTemplate('security/STRIDE.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    writeFile(
      resolvedPath(base, 'docs', 'GOVERNANCE', 'RACI.md'),
      renderTemplate('governance/RACI.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    // Arbiter-managed gate script — always regenerate to pick up script changes
    writeFile(
      resolvedPath(base, 'scripts', 'check-stride-traceability.mjs'),
      renderTemplate('scripts/check-stride-traceability.mjs.ejs', data),
      { skipIfExists: false, dryRun: opts.dryRun },
    ),
  ]

  // L4 only: risk assessment document (user-edited, skip if exists)
  if (config.governanceLevel === 'L4') {
    results.push(
      writeFile(
        resolvedPath(base, 'docs', 'SECURITY', 'RISK_ASSESSMENT.md'),
        renderTemplate('security/RISK_ASSESSMENT.md.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  return { files: results }
}
