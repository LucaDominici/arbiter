// SPDX-License-Identifier: Apache-2.0
// F5: Pharma audit-trail overlay generator (#888)
// Emits KIT dims 73-75 compliant audit scaffolding for Java pharmaceutical projects.
// Gate: language === 'java' AND industryOverlay === 'pharma'

import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface PharmaGeneratorResult {
  files: WriteResult[]
}

/**
 * Derive the audit package path from basePackage.
 * Falls back to flat 'audit' if basePackage is absent.
 */
function auditMainPkg(config: ProjectConfig): string {
  if (config.basePackage) {
    return `src/main/java/${config.basePackage.replace(/\./g, '/')}/audit`
  }
  return 'src/main/java/audit'
}

/**
 * Derive the architecture test package path from basePackage.
 * Falls back to flat 'architecture' if basePackage is absent.
 */
function archTestPkg(config: ProjectConfig): string {
  if (config.basePackage) {
    return `src/test/java/${config.basePackage.replace(/\./g, '/')}/architecture`
  }
  return 'src/test/java/architecture'
}

/**
 * Generate pharma audit-trail overlay for Java projects.
 *
 * Emits three files:
 * 1. AuditEvent.java — JPA entity capturing actor, action, entity, old/new values (KIT dim 73-74)
 * 2. AuditMapper.java — MapStruct mapper converting domain events to AuditEvent records (KIT dim 75)
 * 3. PharmaArchUnitTest.java — ArchUnit rules R-35..R-39 enforcing audit-trail invariants
 *
 * All three use skipIfExists so brownfield re-init does not overwrite user customisations.
 */
export function generatePharma(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): PharmaGeneratorResult {
  // Java-only guard
  if (config.language !== 'java') {
    return { files: [] }
  }

  // Overlay guard — absent or 'none' → skip
  if (!config.industryOverlay || config.industryOverlay === 'none') {
    return { files: [] }
  }

  const base = config.targetDir
  const data = config
  const skip = { skipIfExists: true, dryRun: opts.dryRun } as const

  const mainPkg = auditMainPkg(config)
  const testPkg = archTestPkg(config)

  const files: WriteResult[] = [
    // KIT dim 73-74: audit event JPA entity
    writeFile(
      resolvedPath(base, mainPkg, 'AuditEvent.java'),
      renderTemplate('java/pharma/AuditEvent.java.ejs', data),
      skip,
    ),
    // KIT dim 75: MapStruct audit trail mapper
    writeFile(
      resolvedPath(base, mainPkg, 'AuditMapper.java'),
      renderTemplate('java/pharma/AuditMapper.java.ejs', data),
      skip,
    ),
    // ArchUnit R-35..R-39: pharma compliance rules
    writeFile(
      resolvedPath(base, testPkg, 'PharmaArchUnitTest.java'),
      renderTemplate('java/pharma/archunit-pharma.ejs', data),
      skip,
    ),
  ]

  return { files }
}
