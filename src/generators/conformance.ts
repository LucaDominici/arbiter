// SPDX-License-Identifier: Apache-2.0
// CANON-05/11: generator for scripts/conformance.mjs (#1398, INV-128).
//
// Existing Code Survey: grepped for "export function generate.*conformance" in src/ → 0 results.
// check-stack-conformity.ts is a stack-drift gate (different axis); no conformance scorecard
// generator exists. New file justified (CANON-16).
//
// Emits a self-contained advisory runner that points at `gold-audit` (the standalone
// conformance command was retired, #2628). Sole emitter: the always-on registry entry
// (not check-all.ts, #1578); advisory (runWarnCheck) in check-all.mjs.ejs L2. skipIfExists: true.
import { writeFile, resolvedPath } from '../utils/fs.js'
import { renderTemplate } from '../utils/render.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface ConformanceScriptResult {
  files: WriteResult[]
}

/**
 * #1398 (INV-128): emit scripts/conformance.mjs for governed target projects —
 * an advisory pointer to `npx @getarbiter/cli gold-audit`, exit 0/2 (INV-53).
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
