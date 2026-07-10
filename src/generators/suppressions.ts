// SPDX-License-Identifier: Apache-2.0
import { renderTemplate, resolveServiceBucket } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface SuppressionsGeneratorResult {
  files: WriteResult[]
}

export function generateSuppressions(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): SuppressionsGeneratorResult {
  const base = config.targetDir
  const data = config

  // Always emit — inline comment directives (INV-31) are unconditional in check-all.mjs.ejs (#242)
  const results: WriteResult[] = [
    writeFile(
      resolvedPath(base, 'scripts', 'check-inline-suppressions.mjs'),
      renderTemplate('scripts/check-inline-suppressions.mjs.ejs', data),
      { skipIfExists: false, dryRun: opts.dryRun },
    ),
  ]

  if (!config.enableSuppressions) return { files: results }

  results.push(
    // User-edited data stores — skip on update to preserve live suppression entries
    writeFile(
      resolvedPath(base, 'suppressions', '.gitleaksignore'),
      renderTemplate('suppressions/gitleaksignore.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    writeFile(
      resolvedPath(base, 'suppressions', 'pii-allowlist.json'),
      renderTemplate('suppressions/pii-allowlist.json.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    ...(config.language === 'java'
      ? [
          writeFile(
            resolvedPath(base, 'suppressions', 'archunit-baseline.json'),
            renderTemplate('suppressions/archunit-baseline.json.ejs', data),
            { skipIfExists: true, dryRun: opts.dryRun },
          ),
        ]
      : []),
    // Arbiter-managed files — always regenerate to pick up gate script changes
    writeFile(
      resolvedPath(base, 'suppressions', 'suppressions-schema.json'),
      renderTemplate('suppressions/suppressions-schema.json.ejs', data),
      { skipIfExists: false, dryRun: opts.dryRun },
    ),
    writeFile(
      resolvedPath(base, 'scripts', 'check-suppressions.mjs'),
      renderTemplate('scripts/check-suppressions.mjs.ejs', data),
      { skipIfExists: false, dryRun: opts.dryRun },
    ),
  )

  // Trivy fs suppression file, at ROOT (R-04 — every trivy step across the generated
  // workflows references `trivyignores: .trivyignore`, root-relative). Emitted for:
  //   - JVM (java/kotlin/multi): Trivy fs is the dependency-audit tool (INV-13).
  //   - any service archetype: the container-scan trivy steps (02-pr-extended,
  //     04-deploy-test, 05-release trivy-strict-release) reference this file for
  //     EVERY language, not just JVM, and run regardless of governance level.
  const isJvm =
    config.language === 'java' || config.language === 'kotlin' || config.language === 'multi'
  const isService = resolveServiceBucket(config.archetype) === 'service'
  if (isJvm || isService) {
    results.push(
      writeFile(
        resolvedPath(base, '.trivyignore'),
        renderTemplate('suppressions/trivyignore.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  // #1737 (Track-B counterpart of arbiter-self's #1718): published npm library L2+ only —
  // consumer-resolution audit disposition allowlist. Same predicate as the paired
  // check-consumer-audit.mjs gate in check-all.ts's emitConsumerAudit.
  if (
    config.archetype === 'library' &&
    config.language === 'typescript' &&
    config.governanceLevel !== 'L1'
  ) {
    results.push(
      writeFile(
        resolvedPath(base, 'suppressions', 'consumer-audit-allowlist.json'),
        renderTemplate('suppressions/consumer-audit-allowlist.json.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  return { files: results }
}
