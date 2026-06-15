// SPDX-License-Identifier: Apache-2.0
// CANON-05/11: generator for scripts/conformance.mjs (#1398, INV-128).
//
// Existing Code Survey: grepped for "export function generate.*conformance" in src/ → 0 results.
// check-stack-conformity.ts is a stack-drift gate (different axis); no conformance scorecard
// generator exists. New file justified (CANON-16).
//
// Emits a thin conformance scorecard runner that delegates to `arbiter conformance` via npx.
// Wired as UNCONDITIONAL_EMISSIONS entry in check-all.ts; invoked as advisory (runWarnCheck)
// in check-all.mjs.ejs L2 — never hard-fails the gate.
// skipIfExists: false (no user customisation expected — re-gen always safe).
import { writeFile, resolvedPath } from '../utils/fs.js'
import { renderTemplate } from '../utils/render.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface ConformanceScriptResult {
  files: WriteResult[]
}

/**
 * #1398 (INV-128): emit scripts/conformance.mjs for governed target projects.
 * The script delegates to `arbiter conformance --check` via npx so target
 * projects need no local arbiter install to run the scorecard.
 */
export function generateConformanceScript(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): ConformanceScriptResult {
  const path = resolvedPath(config.targetDir, 'scripts', 'conformance.mjs')
  const content = renderTemplate('scripts/conformance.mjs.ejs', config)
  return {
    files: [writeFile(path, content, { skipIfExists: true, dryRun: opts.dryRun })],
  }
}
