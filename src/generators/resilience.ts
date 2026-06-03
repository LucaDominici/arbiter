// SPDX-License-Identifier: Apache-2.0
// CATALOG: resilience — circuit-breaker/retry/rate-limiter/timeout guide
// Gate: archetype=backend-web-db, governanceLevel≠L1
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

interface ResilienceGeneratorResult {
  files: WriteResult[]
}

export function generateResilience(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): ResilienceGeneratorResult {
  if (config.archetype !== 'backend-web-db' || config.governanceLevel === 'L1') {
    return { files: [] }
  }

  return {
    files: [
      writeFile(
        resolvedPath(config.targetDir, 'docs', 'GOVERNANCE', 'RESILIENCE.md'),
        renderTemplate('resilience/RESILIENCE.md.ejs', config),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    ],
  }
}
