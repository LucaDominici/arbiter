// SPDX-License-Identifier: Apache-2.0
// generator for scripts/pr-merge-watch.mjs, scripts/capacity-probe.mjs, and their
// shared scripts/lib/waiter-count.mjs (#2098).
//
// Existing Code Survey (CANON-16): grepped src/generators/ for
// "pr-merge-watch|capacity-probe|waiter-count" and for a merge-on-green /
// queue-depth generator → 0 results. Nearest neighbour is conformance.ts's
// thin-runner shape (one always-on generator, skipIfExists, no governance-
// level gate), followed here. New files justified.
//
// Static content — no EJS interpolation. These are project-agnostic
// orchestration tools (not gate infrastructure), so template === materialized
// byte-for-byte, same as conformance.mjs.ejs / scripts/conformance.mjs.
// skipIfExists: true — never clobber a hand-edited copy.
import { writeFile, resolvedPath } from '../utils/fs.js'
import { renderTemplate } from '../utils/render.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface PrToolingResult {
  files: WriteResult[]
}

export function generatePrTooling(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): PrToolingResult {
  const files: WriteResult[] = [
    writeFile(
      resolvedPath(config.targetDir, 'scripts', 'lib', 'exact-sha-policy.mjs'),
      renderTemplate('scripts/lib/exact-sha-policy.mjs.ejs', config),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    writeFile(
      resolvedPath(config.targetDir, 'scripts', 'lib', 'waiter-count.mjs'),
      renderTemplate('scripts/lib/waiter-count.mjs.ejs', config),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    writeFile(
      resolvedPath(config.targetDir, 'scripts', 'pr-merge-watch.mjs'),
      renderTemplate('scripts/pr-merge-watch.mjs.ejs', config),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    writeFile(
      resolvedPath(config.targetDir, 'scripts', 'capacity-probe.mjs'),
      renderTemplate('scripts/capacity-probe.mjs.ejs', config),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  ]
  return { files }
}
