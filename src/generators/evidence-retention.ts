// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface EvidenceRetentionResult {
  files: WriteResult[]
}

export function generateEvidenceRetention(config: ProjectConfig): EvidenceRetentionResult {
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
      { skipIfExists: false, backup: true },
    ),
    // Prune script — keep-last + keep-days + dry-run + ACK guard (#718)
    writeFile(
      resolvedPath(base, 'scripts', 'evidence-prune.mjs'),
      renderTemplate('scripts/evidence-prune.mjs.ejs', data),
      { skipIfExists: true },
    ),
    // Seed .gitignore with common entries + .evidence/ — skip if user already has one
    writeFile(resolvedPath(base, '.gitignore'), renderTemplate('root/.gitignore.ejs', data), {
      skipIfExists: true,
    }),
  ]

  // L2+: emit done-evidence CLI + per-archetype pin config (ADR-037)
  if (config.governanceLevel !== 'L1') {
    files.push(
      writeFile(
        resolvedPath(base, 'scripts', 'done-evidence.mjs'),
        renderTemplate('scripts/done-evidence.mjs.ejs', data),
        { skipIfExists: false, backup: true },
      ),
      writeFile(
        resolvedPath(base, 'evidence-files.json'),
        renderTemplate('evidence-files.json.ejs', data),
        { skipIfExists: true },
      ),
      // Policy doc (#718) — explains retention parameters + scripts
      writeFile(
        resolvedPath(base, 'docs', 'governance', 'evidence-retention.md'),
        renderTemplate('governance/evidence-retention.md.ejs', data),
        { skipIfExists: true },
      ),
    )
  }

  return { files }
}
