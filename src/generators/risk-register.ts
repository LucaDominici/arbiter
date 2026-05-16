// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface RiskRegisterResult {
  files: WriteResult[]
}

export function generateRiskRegister(config: ProjectConfig): RiskRegisterResult {
  const base = config.targetDir
  return {
    files: [
      writeFile(
        resolvedPath(base, 'docs', 'GOVERNANCE', 'RISK_REGISTER.md'),
        renderTemplate('governance/risk-register.md.ejs', config),
        { skipIfExists: true },
      ),
      writeFile(
        resolvedPath(base, 'docs', 'GOVERNANCE', 'RISK_ASSESSMENT_TEMPLATE.md'),
        renderTemplate('governance/risk-assessment-template.md.ejs', config),
        { skipIfExists: true },
      ),
    ],
  }
}
