// SPDX-License-Identifier: Apache-2.0
// generator for scripts/pr-merge-watch.mjs, scripts/capacity-probe.mjs, and their
// shared scripts/lib/waiter-count.mjs (#2098), plus the M16 terminal-handoff helpers
// scripts/bg-run.sh and scripts/pid-watch.sh (#2103).
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
import { chmodTranslated, resolvedPath, writeFile } from '../utils/fs.js'
import { renderTemplate } from '../utils/render.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

/** Executable-bit mode for the emitted shell helpers (setup-repo.sh precedent). */
const SCRIPT_MODE = 0o755

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
    // #2103 — M16 terminal handoff helpers (bg-run.sh launches detached + records
    // pid/exit/log; pid-watch.sh is the coordinator's until-loop, exactly one exit line).
    // Static content, same skipIfExists contract as their #2098 siblings above; chmod
    // follows the setup-repo.sh precedent (github-setup.ts).
    writeFile(
      resolvedPath(config.targetDir, 'scripts', 'bg-run.sh'),
      renderTemplate('scripts/bg-run.sh.ejs', config),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    writeFile(
      resolvedPath(config.targetDir, 'scripts', 'pid-watch.sh'),
      renderTemplate('scripts/pid-watch.sh.ejs', config),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  ]

  if (!opts.dryRun) {
    for (const rel of ['scripts/bg-run.sh', 'scripts/pid-watch.sh']) {
      const scriptPath = resolvedPath(config.targetDir, rel)
      chmodTranslated(scriptPath, SCRIPT_MODE)
    }
  }
  return { files }
}
