// SPDX-License-Identifier: Apache-2.0
/**
 * Generator: single-developer exception pack (#1250, ADR-091)
 *
 * Emits three regulated mono-dev pack deliverables for projects using
 * collaborationMode='trunk-solo' at governanceLevel ≥ L3:
 *
 * 1. docs/governance/SOLO_DEV_EXCEPTION.md — attestation doc (§11.10(k))
 * 2. docs/governance/VALIDATION_EVIDENCE_TEMPLATE.md — signed evidence template
 * 3. docs/governance/CI_MENTAL_MODEL.md — five-stage pipeline mental model
 * 4. scripts/check-solo-reactivation.mjs — reactivation trigger check
 *
 * Reactivation trigger fires (exit 1) when:
 *   - ≥3 distinct active authors in trailing 30 days, OR
 *   - EXTERNAL_AUDIT=true environment variable is set
 */
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface SoloExceptionResult {
  files: WriteResult[]
}

/**
 * Input to the reactivation-trigger predicate.
 * Exported for unit-testability (no I/O in this function).
 */
export interface ReactivationInput {
  /** Number of distinct author emails in the trailing 30-day git log. */
  distinctAuthorCount: number
  /** True when EXTERNAL_AUDIT=true env var is set. */
  externalAudit: boolean
}

/**
 * Pure predicate: returns true when the single-developer exception should
 * be reactivated (i.e., the project must switch to peer-review mode).
 *
 * Trigger conditions (either is sufficient):
 *  - distinctAuthorCount ≥ 3 (≥3 active authors trailing 30d)
 *  - externalAudit === true
 */
export function shouldReactivate(input: ReactivationInput): boolean {
  return input.distinctAuthorCount >= 3 || input.externalAudit
}

/**
 * Generate the regulated mono-dev pack for trunk-solo ≥ L3 projects.
 *
 * Emits nothing and returns { files: [] } for non-qualifying configs
 * (collaborationMode !== 'trunk-solo' OR governanceLevel < L3).
 */
export function generateSoloException(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): SoloExceptionResult {
  // Only applies to trunk-solo at L3 or L4
  if (config.collaborationMode !== 'trunk-solo') return { files: [] }
  if (config.governanceLevel !== 'L3' && config.governanceLevel !== 'L4') return { files: [] }

  const base = config.targetDir
  const data = config
  const skip = { skipIfExists: true, dryRun: opts.dryRun } as const
  const overwrite = { skipIfExists: false, dryRun: opts.dryRun } as const
  const govDir = resolvedPath(base, 'docs', 'governance')
  const scriptsDir = resolvedPath(base, 'scripts')

  return {
    files: [
      // Deliverable 1: attestation doc (§11.10(k))
      writeFile(
        resolvedPath(govDir, 'SOLO_DEV_EXCEPTION.md'),
        renderTemplate('governance/solo-dev-exception.md.ejs', data),
        skip,
      ),
      // Deliverable 2: validation-evidence template (signed, real-run-measured metrics)
      writeFile(
        resolvedPath(govDir, 'VALIDATION_EVIDENCE_TEMPLATE.md'),
        renderTemplate('governance/validation-evidence.md.ejs', data),
        skip,
      ),
      // Deliverable 3: five-stage CI mental model doc
      writeFile(
        resolvedPath(govDir, 'CI_MENTAL_MODEL.md'),
        renderTemplate('governance/ci-mental-model.md.ejs', data),
        skip,
      ),
      // Reactivation trigger check script (always regenerated — arbiter-managed)
      writeFile(
        resolvedPath(scriptsDir, 'check-solo-reactivation.mjs'),
        renderTemplate('scripts/check-solo-reactivation.mjs.ejs', data),
        overwrite,
      ),
    ],
  }
}
