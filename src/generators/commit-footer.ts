// SPDX-License-Identifier: Apache-2.0
// CATALOG: Commit-footer-rationale generator — emits check-commit-footer-rationale.mjs to the
// CATALOG:   target scripts/ dir (INV-119, §11.10(e)). The gate scans the origin/main..HEAD range
// CATALOG:   for commits touching suppression/bypass files and requires a recognized footer trailer.
// CATALOG: Wired (#1319.1) because check-all.mjs.ejs invokes scripts/check-commit-footer-rationale.mjs
// CATALOG:   at L2+; without emission a virgin-init L2 gate fails with a missing-module error.
// CATALOG: Distinct from anti-proforma.ts (test-assertion scan, different INV axis). The emitted
// CATALOG:   script fails-OPEN (exit 0 + SKIP) when origin/main is unreachable so a virgin repo
// CATALOG:   with no upstream does not false-fail.
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface CommitFooterGeneratorResult {
  files: WriteResult[]
}

export function generateCommitFooter(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): CommitFooterGeneratorResult {
  const base = config.targetDir
  const data = config

  return {
    files: [
      writeFile(
        resolvedPath(base, 'scripts', 'check-commit-footer-rationale.mjs'),
        renderTemplate('scripts/check-commit-footer-rationale.mjs.ejs', data),
        { dryRun: opts.dryRun },
      ),
    ],
  }
}
