// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface AntiDriftValidatorsResult {
  files: WriteResult[]
}

/**
 * W6 Anti-Drift Validator Family (INV-89)
 *
 * Emits 11 check-*.mjs scripts for target projects:
 * - 9 dual-track scripts (also wired in arbiter's own check-all.mjs)
 * - 2 Track-B-only scripts (not wired in arbiter's own gate)
 *
 * These scripts catch configuration drift, secret leakage, suppression quality
 * issues, and workflow structural problems in generated projects.
 */
export function generateAntiDriftValidators(config: ProjectConfig): AntiDriftValidatorsResult {
  const results: WriteResult[] = []
  const base = config.targetDir

  // ─── Dual-track scripts (also wired in arbiter's L1 gate) ───────────────────

  results.push(
    writeFile(
      resolvedPath(base, 'scripts', 'check-suppression-rationale.mjs'),
      renderTemplate('scripts/check-suppression-rationale.mjs.ejs', config),
      { skipIfExists: true },
    ),
  )

  results.push(
    writeFile(
      resolvedPath(base, 'scripts', 'check-suppression-expiry.mjs'),
      renderTemplate('scripts/check-suppression-expiry.mjs.ejs', config),
      { skipIfExists: true },
    ),
  )

  results.push(
    writeFile(
      resolvedPath(base, 'scripts', 'check-pii-scan.mjs'),
      renderTemplate('scripts/check-pii-scan.mjs.ejs', config),
      { skipIfExists: true },
    ),
  )

  results.push(
    writeFile(
      resolvedPath(base, 'scripts', 'check-secret-scan.mjs'),
      renderTemplate('scripts/check-secret-scan.mjs.ejs', config),
      { skipIfExists: true },
    ),
  )

  results.push(
    writeFile(
      resolvedPath(base, 'scripts', 'check-drift.mjs'),
      renderTemplate('scripts/check-drift.mjs.ejs', config),
      { skipIfExists: true },
    ),
  )

  results.push(
    writeFile(
      resolvedPath(base, 'scripts', 'check-workflow-runners.mjs'),
      renderTemplate('scripts/check-workflow-runners.mjs.ejs', config),
      { skipIfExists: true },
    ),
  )

  results.push(
    writeFile(
      resolvedPath(base, 'scripts', 'check-workflow-docs-sync.mjs'),
      renderTemplate('scripts/check-workflow-docs-sync.mjs.ejs', config),
      { skipIfExists: true },
    ),
  )

  results.push(
    writeFile(
      resolvedPath(base, 'scripts', 'check-workflow-test-integrity.mjs'),
      renderTemplate('scripts/check-workflow-test-integrity.mjs.ejs', config),
      { skipIfExists: true },
    ),
  )

  results.push(
    writeFile(
      resolvedPath(base, 'scripts', 'check-pr-size-gate.mjs'),
      renderTemplate('scripts/check-pr-size-gate.mjs.ejs', config),
      { skipIfExists: true },
    ),
  )

  // ─── Track-B-only scripts (emitted for target projects; not wired in arbiter) ─

  results.push(
    writeFile(
      resolvedPath(base, 'scripts', 'check-workflow-sha-pinning.mjs'),
      renderTemplate('scripts/check-workflow-sha-pinning.mjs.ejs', config),
      { skipIfExists: true },
    ),
  )

  results.push(
    writeFile(
      resolvedPath(base, 'scripts', 'check-workflow-job-naming.mjs'),
      renderTemplate('scripts/check-workflow-job-naming.mjs.ejs', config),
      { skipIfExists: true },
    ),
  )

  return { files: results }
}
