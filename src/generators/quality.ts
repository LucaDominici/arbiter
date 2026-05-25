// SPDX-License-Identifier: Apache-2.0
// CATALOG: Quality generator — emits sonar-project.properties for Java and TypeScript projects
// CATALOG: at governance L2+. Go/Python/Rust use different tooling; this generator is a no-op
// CATALOG: for those languages. Distinct lifecycle from docs.ts (build-quality artefact vs docs).
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface QualityGeneratorResult {
  files: WriteResult[]
}

const SONAR_SUPPORTED_LANGUAGES = new Set(['java', 'typescript'])

export function generateQuality(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): QualityGeneratorResult {
  if (config.governanceLevel === 'L1') return { files: [] }
  if (!SONAR_SUPPORTED_LANGUAGES.has(config.language)) return { files: [] }

  const base = config.targetDir
  const data = config

  return {
    files: [
      writeFile(
        resolvedPath(base, 'sonar-project.properties'),
        renderTemplate('sonar-project.properties.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    ],
  }
}
