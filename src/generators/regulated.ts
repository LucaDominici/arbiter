// SPDX-License-Identifier: Apache-2.0
// Regulated / high-assurance compliance overlay generator.
//
// industryOverlay === 'regulated' bundles + enforces the controls a high-assurance
// project is expected to keep wired, expressed in arbiter's neutral vocabulary
// (no domain-specific identifiers):
//   1. separation-of-duties  — an AI-authored PR requires an independent human
//      approval (extends the ai-draft-check workflow with a checkable policy floor)
//   2. audit-trail retention — a minimum retention horizon for the audit trail
//   3. suppression-expiry    — every suppression carries a mandatory, bounded expiry
//   4. signing + SBOM        — release artefacts are cosign-signed with an SBOM
//   5. mutation-coverage     — a minimum mutation score floor
//
// The overlay emits a machine-readable policy manifest (.arbiter/regulated/overlay.json),
// a fail-closed gate (scripts/check-regulated-overlay.mjs) that enforces the regulated
// MINIMUMS so the bundle cannot be silently weakened while still claiming "regulated",
// and a human-readable policy doc. Orthogonal to the audit-trail docs which the
// `pharma` registry spec emits for any non-none overlay — this generator adds ONLY
// the regulated-specific bundle. Language-neutral: identical artefacts on every stack.

import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface RegulatedGeneratorResult {
  files: WriteResult[]
}

/**
 * Emit the regulated / high-assurance compliance overlay. Fires only when
 * `industryOverlay === 'regulated'`; returns no files for any other overlay so
 * it never hijacks the audit-trail / quality-process overlays.
 *
 * Three deliverables:
 *   - `.arbiter/regulated/overlay.json` — policy manifest (skipIfExists; user-tunable
 *     above the regulated floor the gate enforces)
 *   - `scripts/check-regulated-overlay.mjs` — fail-closed enforcement gate (always
 *     regenerated to pick up gate logic changes)
 *   - `docs/compliance/regulated-overlay.md` — policy doc (skipIfExists, brownfield-safe)
 */
export function generateRegulated(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): RegulatedGeneratorResult {
  if (config.industryOverlay !== 'regulated') {
    return { files: [] }
  }

  const base = config.targetDir
  const data = config
  const userData = { skipIfExists: true, dryRun: opts.dryRun } as const
  const managed = { skipIfExists: false, dryRun: opts.dryRun } as const

  const files = [
    writeFile(
      resolvedPath(base, '.arbiter/regulated', 'overlay.json'),
      renderTemplate('regulated/overlay.json.ejs', data),
      userData,
    ),
    writeFile(
      resolvedPath(base, 'scripts', 'check-regulated-overlay.mjs'),
      renderTemplate('scripts/check-regulated-overlay.mjs.ejs', data),
      managed,
    ),
    writeFile(
      resolvedPath(base, 'docs/compliance', 'regulated-overlay.md'),
      renderTemplate('regulated/regulated-overlay.md.ejs', data),
      userData,
    ),
  ]

  return { files }
}
