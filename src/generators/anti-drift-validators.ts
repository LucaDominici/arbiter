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
    // #1266: thin context-file linter (CLAUDE.md/AGENTS.md) — dual-track (arbiter self-gate + target).
    'check-claude-md-lint.mjs',
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

/**
 * #1318.2 — the github-setup generator owns these three scripts, but only emits
 * them when its registry spec is enabled:
 *   (config.permitGitHub ?? config.useGitHub) && config.governanceLevel !== 'L1'
 * At L1 OR github-off, github-setup is disabled and anti-drift is the SOLE
 * emitter. This mirrors that exact predicate so anti-drift emits the trio ONLY
 * as a fallback — preventing the double-write noise when github-setup also runs.
 */
function githubSetupEnabled(config: ProjectConfig): boolean {
  return (config.permitGitHub ?? config.useGitHub) && config.governanceLevel !== 'L1'
}

/** Emit F4 batch — agnostic anti-drift validators not owned by any other generator (INV-89). */
function emitF4Validators(
  base: string,
  config: ProjectConfig,
  opts: { dryRun: boolean },
): WriteResult[] {
  // #1152: check-tier-coverage.mjs intentionally NOT emitted — it is an
  // arbiter-self meta-gate that asserts arbiter's own check-all tier names; it
  // fails in a target whose gate has a different tier set.
  //
  // #1318.2: anti-drift no longer double-emits scripts whose dedicated owner
  // ALWAYS runs — check-ssot-core (ssot generator, enabled:true),
  // check-exit-code-contract (self-validation generator), and
  // check-suppressions + check-inline-suppressions (suppressions generator).
  // Those owners emit unconditionally, so a second anti-drift write only produced
  // the cosmetic "N file(s) already exist" init noise (a benign skipIfExists
  // skip). check-validator-helptext has NO other owner, so anti-drift keeps it.
  const scripts = ['check-validator-helptext.mjs']

  // #1318.2: the github-owned trio is a conditional FALLBACK — emit only when
  // github-setup is disabled (else github-setup is the owner and a second write
  // here re-introduces the double-write). At L1 or github-off, anti-drift is the
  // sole emitter, so removing them unconditionally would regress to a missing
  // module in check-all (RT-CRITICAL — must not drop).
  if (!githubSetupEnabled(config)) {
    scripts.push('check-action-pins.mjs', 'check-workflow-perms.mjs', 'check-ci-tiers.mjs')
  }

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
 * Emits check-*.mjs scripts for target projects (#1152, #1266, #1318.2):
 * - W6 batch (11 scripts):
 *   - 9 dual-track scripts (check-pii-scan excluded — duplicates native pii-scan;
 *     check-claude-md-lint added #1266 — thin CLAUDE.md/AGENTS.md context-file linter)
 *   - 2 Track-B-only scripts (not wired in arbiter's own gate)
 * - F4 batch: check-validator-helptext (anti-drift is sole owner) + the
 *   github-owned trio (check-action-pins/check-workflow-perms/check-ci-tiers) as
 *   a CONDITIONAL FALLBACK — emitted only when github-setup is disabled (L1 or
 *   github-off). #1318.2 dropped the 4 always-on-owned scripts (check-ssot-core,
 *   check-exit-code-contract, check-suppressions, check-inline-suppressions) to
 *   stop the double-write "already exists" init noise — their owners always run.
 *   (check-tier-coverage excluded — arbiter-self meta-gate, not target-portable.)
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
