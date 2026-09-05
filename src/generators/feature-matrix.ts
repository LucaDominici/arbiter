// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface FeatureMatrixResult {
  files: WriteResult[]
}

/**
 * Generate docs/FEATURE_MATRIX.md for governed projects at L2+ (INV-112, CANON-23).
 *
 * Track B generator: scaffold the initial matrix template. The generated file is
 * user-owned after the first write (skipIfExists). The gate (check-feature-matrix.mjs)
 * validates the committed matrix on every gate run.
 */
export function generateFeatureMatrix(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): FeatureMatrixResult {
  if (config.governanceLevel === 'L1') return { files: [] }

  const base = config.targetDir
  const data = config

  const result = writeFile(
    resolvedPath(base, 'docs', 'FEATURE_MATRIX.md'),
    renderTemplate('docs/FEATURE_MATRIX.md.ejs', data),
    { skipIfExists: true, dryRun: opts.dryRun },
  )

  // #1887-B: the emitted doc's own comment promises "The gate
  // (check-feature-matrix.mjs) validates the committed matrix on every gate
  // run" — but that gate was never emitted into the target project (only
  // arbiter's own internal copy existed). Fulfill the promise.
  const gate = writeFile(
    resolvedPath(base, 'scripts', 'check-feature-matrix.mjs'),
    renderTemplate('scripts/check-feature-matrix.mjs.ejs', data),
    { skipIfExists: true, dryRun: opts.dryRun },
  )

  // #2480: RTM axis 2 needs the contract it validates against. Emitting the gate without the
  // schema would hand a governed project an ERROR the moment it marked a row `Verified` — worse
  // than not porting the rule at all, which is why the axis stayed self-only until this wave.
  // Never skipIfExists: the schema is arbiter's contract, not the project's document, and a stale
  // copy would silently admit envelopes the current rule refuses.
  const schema = writeFile(
    resolvedPath(base, 'schemas', 'rtm-verdict.schema.json'),
    renderTemplate('schemas/rtm-verdict.schema.json.ejs', data),
    { dryRun: opts.dryRun },
  )

  return { files: [result, gate, schema] }
}
