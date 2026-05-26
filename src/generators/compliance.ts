// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface ComplianceGeneratorResult {
  files: WriteResult[]
}

export function generateCompliance(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): ComplianceGeneratorResult {
  const path = resolvedPath(config.targetDir, 'docs', 'COMPLIANCE_MAPPING.md')
  const content = renderTemplate('compliance/compliance-mapping.md.ejs', config)
  return {
    files: [writeFile(path, content, { skipIfExists: true, dryRun: opts.dryRun })],
  }
}
