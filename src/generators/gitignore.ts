// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface GitignoreResult {
  files: WriteResult[]
}

/**
 * Emit a baseline `.gitignore` UNCONDITIONALLY on every init (B6/#1491, M3).
 *
 * Previously the only `.gitignore` emission lived inside `generateEvidenceRetention`,
 * gated on `enableEvidenceHarness` — off by default at L1/L2. So an L1/L2 user got
 * `.arbiter/`, `.evidence/`, `coverage/`, `node_modules/` written into their repo with
 * no `.gitignore`, and the obvious next step (`git add -A`) committed arbiter's
 * ephemeral runtime state. This generator is always-on in the registry so the baseline
 * is present at every level regardless of the evidence harness flag.
 *
 * `skipIfExists: true` keeps it brownfield-safe: an existing `.gitignore` is never
 * rewritten (the repo-hygiene gate catches already-tracked artifacts retroactively).
 */
export function generateGitignore(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): GitignoreResult {
  const base = config.targetDir
  const data = {
    ...config,
    evidenceRetention: config.evidenceRetention ?? {
      mode: 'local-last-N',
      count: 5,
    },
  }

  return {
    files: [
      writeFile(resolvedPath(base, '.gitignore'), renderTemplate('root/.gitignore.ejs', data), {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
    ],
  }
}
