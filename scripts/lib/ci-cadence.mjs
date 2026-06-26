// SPDX-License-Identifier: Apache-2.0
// SSOT for arbiter's generated CI cadence model (docs/SYSTEM/CI-TIER-MODEL.md, #1502).
//
// The cadence buckets are an OVERLAY on the existing emit predicates in
// src/generators/github.ts (style = PIPELINE_STYLE_TABLE[mode][level] + the
// isL2Plus / isL3Plus governance floors). They classify WHEN each generated
// workflow runs — they NEVER change WHICH governance level emits a workflow.
//
// This map is consumed by:
//   - scripts/check-ci-tiers.mjs  (asserts every canonical workflow is classified)
//   - __tests__/scripts/ci-cadence.test.ts (partition test)
//   - docs/SYSTEM/CI-TIER-MODEL.md + docs/REFERENCE/ci-tier-workflows.md (the human SSOT)
//
// Adding a new numbered workflow without classifying it here fails the gate — keeping
// the docs, the gate, and the generator in lockstep.

/** Canonical bucket order (fast feedback → deep audit → release). */
export const CADENCE_ORDER = ['ALWAYS', 'NIGHTLY', 'WEEKLY-MONTHLY', 'PROD']

/**
 * Workflow → cadence bucket. Each file appears in EXACTLY one bucket (global partition).
 *
 * - ALWAYS         every PR / push — fast feedback (+ conditional PR security/FE gates).
 * - NIGHTLY        daily schedule — heavy correctness/security sweep + freshness watchdog.
 * - WEEKLY-MONTHLY weekly (Sun/Mon) + monthly schedule — deep audits.
 * - PROD           build-sign-attest-deploy + on-demand load test (release/deploy path only).
 *
 * 15-codeql and 17-ossf-scorecard ALSO carry a weekly cron backstop, but their primary
 * trigger is the PR/push gate (15) and the canonical-branch push (17); they are bucketed
 * by primary purpose. The hybrid is documented in CI-TIER-MODEL.md.
 */
export const CADENCE_BUCKETS = {
  ALWAYS: [
    '01-pr-fast.yml',
    '02-pr-extended.yml',
    '03-human-approval.yml',
    '15-codeql.yml',
    '16-frontend-quality.yml',
    '18-frontend-lane.yml',
  ],
  NIGHTLY: ['06-nightly.yml', '06-nightly-lite.yml', '09-heartbeat.yml'],
  'WEEKLY-MONTHLY': [
    '07-weekly.yml',
    '07-weekly-lite.yml',
    '08-monthly.yml',
    '12-mutation-scheduled.yml',
    '13-archunit-extended.yml',
    '14-license-scan.yml',
    '17-ossf-scorecard.yml',
  ],
  PROD: ['04-deploy-test.yml', '05-release.yml', '10-deploy-prod.yml', '11-k6-on-demand.yml'],
}

/** Resolve the cadence bucket for a workflow filename, or null when unclassified. */
export function cadenceOf(file) {
  for (const bucket of CADENCE_ORDER) {
    if (CADENCE_BUCKETS[bucket].includes(file)) return bucket
  }
  return null
}

/**
 * Verify each canonical workflow is classified into exactly one cadence bucket.
 * Returns a list of human-readable error strings (empty when the partition holds).
 * Called at startup by check-ci-tiers.mjs so a future canonical workflow added without
 * a cadence classification fails the gate loudly.
 */
export function assertCanonicalPartition(canonical) {
  const errors = []
  for (const wf of canonical) {
    const hits = CADENCE_ORDER.filter((b) => CADENCE_BUCKETS[b].includes(wf))
    if (hits.length === 0) {
      errors.push(`cadence: canonical workflow ${wf} is not classified into any cadence bucket`)
    } else if (hits.length > 1) {
      errors.push(
        `cadence: canonical workflow ${wf} is classified into multiple buckets: ${hits.join(', ')}`,
      )
    }
  }
  return errors
}
