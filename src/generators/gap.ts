// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface GapResult {
  files: WriteResult[]
}

/**
 * Generate docs/GAP.md for governed projects at L2+ (mirrors FEATURE_MATRIX precedent).
 *
 * Track B generator: scaffold the initial gap register template. The generated file is
 * user-owned after the first write (skipIfExists). The gate (gen-gap.mjs --check)
 * validates the committed register on every gate run.
 */
export function generateGap(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): GapResult {
  if (config.governanceLevel === 'L1') return { files: [] }

  const base = config.targetDir
  const data = config

  const result = writeFile(
    resolvedPath(base, 'docs', 'GAP.md'),
    renderTemplate('docs/GAP.md.ejs', data),
    { skipIfExists: true, dryRun: opts.dryRun },
  )

  // #1887-B: the emitted doc's own comment promises "The gate (gen-gap.mjs
  // --check) validates the committed register on every gate run" — but that
  // gate was never emitted into the target project. Fulfill the promise.
  const gate = writeFile(
    resolvedPath(base, 'scripts', 'gen-gap.mjs'),
    renderTemplate('scripts/gen-gap.mjs.ejs', data),
    { skipIfExists: true, dryRun: opts.dryRun },
  )

  return { files: [result, gate] }
}
