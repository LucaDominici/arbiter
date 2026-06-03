// SPDX-License-Identifier: Apache-2.0
// F5: Audit-trail overlay generator (#888, #1156)
// industryOverlay === 'pharma' + Java → KIT dims 73-75 Java scaffolding (unchanged).
// industryOverlay ∈ {sox, gdpr, generic} → language-neutral L4 audit-trail docs
//   + gate rules, decoupled from the pharma Java scaffolding.
// Gate (registry): industryOverlay set and !== 'none'.

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
 * Emit the pharma audit-trail overlay for Java projects.
 *
 * Emits three files (all skipIfExists, brownfield-safe):
 * 1. AuditEvent.java — JPA entity (KIT dim 73-74)
 * 2. AuditMapper.java — MapStruct mapper (KIT dim 75)
 * 3. PharmaArchUnitTest.java — ArchUnit rules R-35..R-39
 *
 * Java-only: a pharma overlay on a non-Java project emits nothing.
 */
function generatePharmaJava(config: ProjectConfig, opts: { dryRun: boolean }): WriteResult[] {
  if (config.language !== 'java') return []

  const base = config.targetDir
  const data = config
  const skip = { skipIfExists: true, dryRun: opts.dryRun } as const
  const mainPkg = auditMainPkg(config)
  const testPkg = archTestPkg(config)

  return [
    writeFile(
      resolvedPath(base, mainPkg, 'AuditEvent.java'),
      renderTemplate('java/pharma/AuditEvent.java.ejs', data),
      skip,
    ),
    writeFile(
      resolvedPath(base, mainPkg, 'AuditMapper.java'),
      renderTemplate('java/pharma/AuditMapper.java.ejs', data),
      skip,
    ),
    writeFile(
      resolvedPath(base, testPkg, 'PharmaArchUnitTest.java'),
      renderTemplate('java/pharma/archunit-pharma.ejs', data),
      skip,
    ),
  ]
}

/**
 * Emit the generic, language-neutral L4 audit-trail overlay (#1156) for the
 * sox / gdpr / generic overlays. Emits an audit-trail policy doc and a set of
 * checkable gate rules under docs/compliance/ — no framework- or language-
 * specific scaffolding. skipIfExists so re-init preserves user edits.
 */
function generateGenericAudit(config: ProjectConfig, opts: { dryRun: boolean }): WriteResult[] {
  const base = config.targetDir
  const data = config
  const skip = { skipIfExists: true, dryRun: opts.dryRun } as const

  return [
    writeFile(
      resolvedPath(base, 'docs/compliance', 'audit-trail-policy.md'),
      renderTemplate('audit/generic/audit-trail-policy.md.ejs', data),
      skip,
    ),
    writeFile(
      resolvedPath(base, 'docs/compliance', 'audit-gate-rules.md'),
      renderTemplate('audit/generic/audit-gate-rules.md.ejs', data),
      skip,
    ),
  ]
}

/**
 * Generate the audit-trail overlay. Dispatches on `industryOverlay`:
 *   - 'pharma'             → Java JPA/ArchUnit scaffolding (Java only)
 *   - 'sox' | 'gdpr' | 'generic' → language-neutral audit docs + gate rules (#1156)
 *   - absent | 'none'      → nothing
 */
export function generatePharma(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): PharmaGeneratorResult {
  const overlay = config.industryOverlay
  if (!overlay || overlay === 'none') {
    return { files: [] }
  }

  const files =
    overlay === 'pharma' ? generatePharmaJava(config, opts) : generateGenericAudit(config, opts)

  return { files }
}
