// SPDX-License-Identifier: Apache-2.0
/**
 * Generator: Enterprise Compliance Baseline (#711)
 *
 * Consumer pain removed: projects needing a living compliance reference
 * (ISO 27001, GDPR, NIS2, OWASP ASVS) spend days assembling a skeleton
 * from scratch. This generator emits a structured, framework-neutral
 * skeleton that teams fill in rather than author from zero.
 */
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface EnterpriseComplianceBaselineResult {
  files: WriteResult[]
}

export function generateEnterpriseComplianceBaseline(
  config: ProjectConfig,
): EnterpriseComplianceBaselineResult {
  if (!config.enableEnterpriseComplianceBaseline) {
    return { files: [] }
  }

  const path = resolvedPath(config.targetDir, 'docs', 'SYSTEM', 'ENTERPRISE_COMPLIANCE.md')
  const content = renderTemplate('governance/enterprise-compliance-baseline.md.ejs', config)
  return {
    files: [writeFile(path, content, { skipIfExists: true })],
  }
}
