// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface EvidenceRetentionResult {
  files: WriteResult[]
}

export function generateEvidenceRetention(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): EvidenceRetentionResult {
  const base = config.targetDir
  const data = {
    ...config,
    // Provide defaults so EJS template never sees undefined
    evidenceRetention: config.evidenceRetention ?? {
      mode: 'local-last-N',
      count: 5,
    },
  }

  const files: WriteResult[] = [
    // Arbiter-managed rotation script — always regenerate to pick up changes
    writeFile(
      resolvedPath(base, 'scripts', 'evidence-rotate.mjs'),
      renderTemplate('scripts/evidence-rotate.mjs.ejs', data),
      { skipIfExists: false, backup: true, dryRun: opts.dryRun },
    ),
    // Manual maintenance script — user may customise thresholds; skipIfExists
    writeFile(
      resolvedPath(base, 'scripts', 'evidence-prune.mjs'),
      renderTemplate('scripts/evidence-prune.mjs.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    // NOTE: the baseline .gitignore is emitted UNCONDITIONALLY by `generateGitignore`
    // (registry key `baseline-gitignore`, always-on), not here — gating it on the
    // evidence harness left L1/L2 users with no .gitignore (B6/#1491, M3). Both writes
    // used skipIfExists:true and the same template, so consolidating into the always-on
    // generator changes no brownfield behaviour, only fixes the L1/L2 drop.
    // Policy doc — human-readable retention rules; skipIfExists so users can customise
    writeFile(
      resolvedPath(base, 'docs', 'METHOD', 'EVIDENCE_RETENTION.md'),
      renderTemplate('governance/evidence-retention.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  ]

  // done-evidence CLI is emitted whenever the evidence harness is on — the SAME
  // condition under which its guard hook (guard-done-evidence.mjs) is emitted
  // (src/generators/claude.ts → generateL2AdvancedHooks). Emitting the guard
  // without the script it tells the user to run is a deadlock (#1345): the hook
  // hard-blocks completion until .claude/.last-done-evidence.json exists, but the
  // script that produces it was never shipped. The script's loadConfig() defaults
  // safely when evidence-files.json is absent, so it runs without it.
  if (config.enableEvidenceHarness !== false) {
    files.push(
      writeFile(
        resolvedPath(base, 'scripts', 'done-evidence.mjs'),
        renderTemplate('scripts/done-evidence.mjs.ejs', data),
        { skipIfExists: false, backup: true, dryRun: opts.dryRun },
      ),
    )
  }

  // L4 only: per-archetype pin config (ADR-037). Optional input to done-evidence;
  // the script defaults safely without it, so it stays L4-gated.
  if (config.governanceLevel === 'L4') {
    files.push(
      writeFile(
        resolvedPath(base, 'evidence-files.json'),
        renderTemplate('evidence-files.json.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  return { files }
}
