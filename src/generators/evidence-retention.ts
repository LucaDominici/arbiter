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
    // Seed .gitignore with common entries + .evidence/ — skip if user already has one
    writeFile(resolvedPath(base, '.gitignore'), renderTemplate('root/.gitignore.ejs', data), {
      skipIfExists: true,
      dryRun: opts.dryRun,
    }),
    // Policy doc — human-readable retention rules; skipIfExists so users can customise
    writeFile(
      resolvedPath(base, 'docs', 'METHOD', 'EVIDENCE_RETENTION.md'),
      renderTemplate('governance/evidence-retention.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  ]

  // #1345: emit done-evidence CLI + per-archetype pin config whenever the evidence
  // harness is enabled — NOT L4-only. ADR-037 specifies these artifacts "at L2+"; the
  // harness flag (enableEvidenceHarness) is the single source of truth the whole system
  // keys on (registry.ts gate, guard-done-evidence hook, Makefile evidence: target, ship
  // complete phase). The old `governanceLevel === 'L4'` gate left the producer missing at
  // L1/L2/L3 while every consumer referenced it unconditionally → dangling reference.
  // The registry already gates this generator on the same flag (registry.ts:467); this
  // internal guard is defense-in-depth for direct (non-registry) callers.
  if (config.enableEvidenceHarness !== false) {
    files.push(
      writeFile(
        resolvedPath(base, 'scripts', 'done-evidence.mjs'),
        renderTemplate('scripts/done-evidence.mjs.ejs', data),
        { skipIfExists: false, backup: true, dryRun: opts.dryRun },
      ),
      writeFile(
        resolvedPath(base, 'evidence-files.json'),
        renderTemplate('evidence-files.json.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  return { files }
}
