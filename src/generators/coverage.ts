import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { computeThresholds } from '../config/thresholds.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface CoverageGeneratorResult {
  files: WriteResult[]
}

export function generateCoverage(config: ProjectConfig): CoverageGeneratorResult {
  if (!config.enableDebtGates) return { files: [] }

  const results: WriteResult[] = []
  const base = config.targetDir

  const thresholds = computeThresholds(
    config.linesOfCode ?? 0,
    config.thresholdProfile ?? 'fixed',
    config.governanceLevel,
  )

  const data = {
    ...config,
    coverageThreshold: thresholds.coverageThreshold,
    coverageEnabled: thresholds.coverageEnabled,
  } as unknown as Record<string, unknown>

  if (config.language === 'typescript' || config.language === 'multi') {
    results.push(
      writeFile(
        resolvedPath(base, 'vitest.config.ts'),
        renderTemplate('coverage/vitest.config.ts.ejs', data),
        { skipIfExists: true },
      ),
    )
  }

  if (
    (config.language === 'java' || config.language === 'multi') &&
    config.buildTool === 'gradle'
  ) {
    results.push(
      writeFile(
        resolvedPath(base, 'gradle', 'jacoco.gradle'),
        renderTemplate('coverage/jacoco.gradle.ejs', data),
        { skipIfExists: true },
      ),
    )
  }

  if ((config.language === 'java' || config.language === 'multi') && config.buildTool === 'maven') {
    results.push(
      writeFile(
        resolvedPath(base, 'docs', 'coverage', 'jacoco-maven-setup.md'),
        renderTemplate('coverage/jacoco-maven-setup.md.ejs', data),
        { skipIfExists: true },
      ),
    )
  }

  if (config.language === 'rust') {
    results.push(
      writeFile(
        resolvedPath(base, '.tarpaulin.toml'),
        renderTemplate('coverage/.tarpaulin.toml.ejs', data),
        { skipIfExists: true },
      ),
    )
  }

  if (config.language === 'python') {
    results.push(
      writeFile(
        resolvedPath(base, '.coveragerc'),
        renderTemplate('coverage/.coveragerc.ejs', data),
        { skipIfExists: true },
      ),
    )
  }

  // Go: no config file — gate script handles coverage inline

  return { files: results }
}
