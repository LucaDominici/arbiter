// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface AuditToolchainGeneratorResult {
  files: WriteResult[]
}

/**
 * Generate scripts/audit-toolchain.mjs for a target project.
 *
 * The emitted script checks that required CI workflow files, gate scripts,
 * and the build toolchain are present and functional.
 *
 * Existing Code Survey: self-validation.ts is the closest neighbor but does
 * A/B/C drill harness (proving gates distinguish pass/fail/error). This
 * generator has a different responsibility: inventory audit — checking that
 * required toolchain files exist. These are architecturally distinct.
 */
export function generateAuditToolchain(config: ProjectConfig): AuditToolchainGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir

  const scriptPath = resolvedPath(base, 'scripts', 'audit-toolchain.mjs')
  results.push(
    writeFile(scriptPath, renderTemplate('scripts/audit-toolchain.mjs.ejs', config), {
      skipIfExists: true,
    }),
  )

  return { files: results }
}
