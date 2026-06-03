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
  // #1152: check-pii-scan.mjs intentionally NOT emitted — it duplicates the
  // target-native pii-scan.mjs (already wired in check-all) and fails in a target
  // because it expects an arbiter-internal PII-patterns config file.
  const scripts = [
    'check-suppression-rationale.mjs',
    'check-suppression-expiry.mjs',
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
  // #1152: check-tier-coverage.mjs intentionally NOT emitted — it is an
  // arbiter-self meta-gate that asserts arbiter's own check-all tier names; it
  // fails in a target whose gate has a different tier set.
  const scripts = [
    'check-validator-helptext.mjs',
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
 * Emits 18 check-*.mjs scripts for target projects (#1152):
 * - W6 batch (10 scripts):
 *   - 8 dual-track scripts (check-pii-scan excluded — duplicates native pii-scan)
 *   - 2 Track-B-only scripts (not wired in arbiter's own gate)
 * - F4 batch (8 scripts): remaining agnostic anti-drift validators
 *   (check-tier-coverage excluded — arbiter-self meta-gate, not target-portable)
 *
 * Every emitted script is wired into the generated target's check-all.mjs (under
 * the appropriate conditional) — enforced by the anti-drift emission↔wiring test.
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
