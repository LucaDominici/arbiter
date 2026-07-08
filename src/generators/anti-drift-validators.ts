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
    // #1497: fail-loud secret-presence guard — a workflow step that skips on an empty secret
    // without an explicit vars.SKIP_<NAME> opt-out is a fake-green. Dual-track (arbiter self-gate
    // + target). Self-contained (no lib import) so it runs in any generated project.
    'check-secret-presence.mjs',
    // A3 #1497: parser-backed swallowed-gate guard — a GATING job/step with a const-true
    // continue-on-error swallows its failure (a red gate goes green). Catches the YAML-1.1
    // `on`/`yes` and `${{ true }}` forms the regex sibling misses. Dual-track (arbiter self-gate
    // + target). Self-contained (no lib import) so it runs in any generated project.
    'check-continue-on-error.mjs',
    // A4 #1497: test-scope ↔ tier integrity guard — a test category declared `required` in
    // test-pyramid.json that NO gate step (check-all check or CI workflow) runs is a silent
    // false-green. Dual-track (arbiter self-gate + target). Self-contained (no lib import).
    'check-test-scope-tier.mjs',
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
  const scripts = [
    'check-workflow-sha-pinning.mjs',
    'check-workflow-job-naming.mjs',
    // A2 #1497: no-empty-suite / min-execution guard — runs the project test runner in collect
    // mode and FAILS when it collects 0 tests (the "0 executed = green" false-green). Track-B-only
    // (not wired in arbiter's own gate — arbiter's suite is self-evidently non-empty and a
    // `vitest list` over it adds ~9s for no signal). Self-contained (no lib import).
    'check-min-test-execution.mjs',
  ]
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

/**
 * #1318 — the self-validation generator owns check-exit-code-contract.mjs, but
 * its registry spec is gated `enabled: config.enableSelfValidationHarness !== false`
 * (registry.ts). When a target sets enableSelfValidationHarness:false the owner
 * is disabled, yet check-all.mjs unconditionally calls the script — so anti-drift
 * must be the SOLE fallback emitter (mirrors githubSetupEnabled). This predicate
 * matches the registry gate exactly.
 */
function selfValidationEnabled(config: ProjectConfig): boolean {
  return config.enableSelfValidationHarness !== false
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
  // ALWAYS runs — check-ssot-core (ssot generator, enabled:true) and
  // check-suppressions + check-inline-suppressions (suppressions generator,
  // enabled:true). Those owners emit unconditionally, so a second anti-drift
  // write only produced the cosmetic "N file(s) already exist" init noise (a
  // benign skipIfExists skip). check-validator-helptext has NO other owner, so
  // anti-drift keeps it.
  //
  // #1318: check-exit-code-contract is NOT always-on — its owner
  // (self-validation generator) is gated `enableSelfValidationHarness !== false`
  // (registry.ts). It is a conditional FALLBACK below, like the github trio.
  const scripts = ['check-validator-helptext.mjs']

  // #1318.2: the github-owned trio is a conditional FALLBACK — emit only when
  // github-setup is disabled (else github-setup is the owner and a second write
  // here re-introduces the double-write). At L1 or github-off, anti-drift is the
  // sole emitter, so removing them unconditionally would regress to a missing
  // module in check-all (RT-CRITICAL — must not drop).
  if (!githubSetupEnabled(config)) {
    scripts.push('check-action-pins.mjs', 'check-workflow-perms.mjs', 'check-ci-tiers.mjs')
  }

  // #1318/#1835: check-exit-code-contract and check-pipe-tee-hazard are conditional
  // FALLBACKs — emit only when self-validation is disabled
  // (enableSelfValidationHarness:false). When self-validation IS enabled it owns
  // both scripts and anti-drift stays out (no double-write); when disabled,
  // check-all.mjs still calls both unconditionally (unguarded references), so
  // anti-drift must be the sole emitter of each or the generated gate fails with
  // MODULE_NOT_FOUND (RT-CRITICAL — must not drop). check-pipe-tee-hazard had no
  // fallback until #1835 — a crash-class ghost whenever a project disabled the
  // harness.
  if (!selfValidationEnabled(config)) {
    scripts.push('check-exit-code-contract.mjs', 'check-pipe-tee-hazard.mjs')
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
 * Emits check-*.mjs scripts for target projects (#1152, #1266, #1318.2, #1497):
 * - W6 batch (15 scripts):
 *   - 12 dual-track scripts (check-pii-scan excluded — duplicates native pii-scan;
 *     check-claude-md-lint added #1266 — thin CLAUDE.md/AGENTS.md context-file linter;
 *     check-secret-presence + check-continue-on-error + check-test-scope-tier added #1497)
 *   - 3 Track-B-only scripts (not wired in arbiter's own gate; check-min-test-execution added #1497)
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
