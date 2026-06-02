// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface AntiDriftValidatorsResult {
  files: WriteResult[]
}

/** Emit W6 dual-track scripts (also wired in arbiter's own L1 gate). */
function emitW6DualTrack(
  base: string,
  config: ProjectConfig,
  opts: { dryRun: boolean },
): WriteResult[] {
  const scripts = [
    'check-suppression-rationale.mjs',
    'check-suppression-expiry.mjs',
    'check-pii-scan.mjs',
    'check-secret-scan.mjs',
    'check-drift.mjs',
    'check-workflow-runners.mjs',
    'check-workflow-docs-sync.mjs',
    'check-workflow-test-integrity.mjs',
    'check-pr-size-gate.mjs',
  ]
  return scripts.map((name) =>
    writeFile(resolvedPath(base, 'scripts', name), renderTemplate(`scripts/${name}.ejs`, config), {
      skipIfExists: true,
      dryRun: opts.dryRun,
    }),
  )
}

/** Emit W6 Track-B-only scripts (emitted for target projects; not wired in arbiter). */
function emitW6TrackBOnly(
  base: string,
  config: ProjectConfig,
  opts: { dryRun: boolean },
): WriteResult[] {
  const scripts = ['check-workflow-sha-pinning.mjs', 'check-workflow-job-naming.mjs']
  return scripts.map((name) =>
    writeFile(resolvedPath(base, 'scripts', name), renderTemplate(`scripts/${name}.ejs`, config), {
      skipIfExists: true,
      dryRun: opts.dryRun,
    }),
  )
}

/** Emit F4 batch — 9 remaining agnostic anti-drift validators (INV-89). */
function emitF4Validators(
  base: string,
  config: ProjectConfig,
  opts: { dryRun: boolean },
): WriteResult[] {
  const scripts = [
    'check-validator-helptext.mjs',
    'check-tier-coverage.mjs',
    'check-inline-suppressions.mjs',
    'check-suppressions.mjs',
    'check-action-pins.mjs',
    'check-workflow-perms.mjs',
    'check-exit-code-contract.mjs',
    'check-ssot-core.mjs',
    'check-ci-tiers.mjs',
  ]
  return scripts.map((name) =>
    writeFile(resolvedPath(base, 'scripts', name), renderTemplate(`scripts/${name}.ejs`, config), {
      skipIfExists: true,
      dryRun: opts.dryRun,
    }),
  )
}

/**
 * W6+F4 Anti-Drift Validator Family (INV-89)
 *
 * Emits 20 check-*.mjs scripts for target projects:
 * - W6 batch (11 scripts):
 *   - 9 dual-track scripts (also wired in arbiter's own check-all.mjs)
 *   - 2 Track-B-only scripts (not wired in arbiter's own gate)
 * - F4 batch (9 scripts): remaining agnostic anti-drift validators
 *   making them dual-track for target projects
 *
 * These scripts catch configuration drift, secret leakage, suppression quality
 * issues, and workflow structural problems in generated projects.
 * See docs/REFERENCE/anti-drift-family.md for the full family reference.
 */
export function generateAntiDriftValidators(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): AntiDriftValidatorsResult {
  const base = config.targetDir
  const files: WriteResult[] = [
    ...emitW6DualTrack(base, config, opts),
    ...emitW6TrackBOnly(base, config, opts),
    ...emitF4Validators(base, config, opts),
  ]
  return { files }
}
