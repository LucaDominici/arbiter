// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface EvidenceBacklogResult {
  files: WriteResult[]
}

export function generateEvidenceBacklog(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): EvidenceBacklogResult {
  if (config.governanceLevel !== 'L4') return { files: [] }

  const base = config.targetDir
  const data = config

  return {
    files: [
      writeFile(
        resolvedPath(base, '.evidence', 'BACKLOG.md.template'),
        renderTemplate('evidence/BACKLOG.md.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    ],
  }
}
