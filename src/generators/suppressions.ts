import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface SuppressionsGeneratorResult {
  files: WriteResult[]
}

export function generateSuppressions(config: ProjectConfig): SuppressionsGeneratorResult {
  const base = config.targetDir
  const data = config as unknown as Record<string, unknown>

  // Always emit — inline comment directives (INV-31) are unconditional in check-all.mjs.ejs (#242)
  const results: WriteResult[] = [
    writeFile(
      resolvedPath(base, 'scripts', 'check-inline-suppressions.mjs'),
      renderTemplate('scripts/check-inline-suppressions.mjs.ejs', data),
      { skipIfExists: false },
    ),
  ]

  if (!config.enableSuppressions) return { files: results }

  results.push(
    // User-edited data stores — skip on update to preserve live suppression entries
    writeFile(
      resolvedPath(base, 'suppressions', 'dependency-check-suppressions.xml'),
      renderTemplate('suppressions/dependency-check-suppressions.xml.ejs', data),
      { skipIfExists: true },
    ),
    writeFile(
      resolvedPath(base, 'suppressions', '.gitleaksignore'),
      renderTemplate('suppressions/gitleaksignore.ejs', data),
      { skipIfExists: true },
    ),
    writeFile(
      resolvedPath(base, 'suppressions', 'pii-allowlist.json'),
      renderTemplate('suppressions/pii-allowlist.json.ejs', data),
      { skipIfExists: true },
    ),
    writeFile(
      resolvedPath(base, 'suppressions', 'archunit-baseline.json'),
      renderTemplate('suppressions/archunit-baseline.json.ejs', data),
      { skipIfExists: true },
    ),
    // Arbiter-managed files — always regenerate to pick up gate script changes
    writeFile(
      resolvedPath(base, 'suppressions', 'suppressions-schema.json'),
      renderTemplate('suppressions/suppressions-schema.json.ejs', data),
      { skipIfExists: false },
    ),
    writeFile(
      resolvedPath(base, 'scripts', 'check-suppressions.mjs'),
      renderTemplate('scripts/check-suppressions.mjs.ejs', data),
      { skipIfExists: false },
    ),
  )

  // Java/Kotlin L2+ only: OWASP dependency-check and Trivy suppression files
  if (
    (config.language === 'java' || config.language === 'kotlin' || config.language === 'multi') &&
    config.governanceLevel !== 'L1'
  ) {
    results.push(
      writeFile(
        resolvedPath(base, 'suppressions', 'owasp-suppressions.xml'),
        renderTemplate('suppressions/owasp-suppressions.xml.ejs', data),
        { skipIfExists: true },
      ),
      writeFile(
        resolvedPath(base, 'suppressions', '.trivyignore'),
        renderTemplate('suppressions/trivyignore.ejs', data),
        { skipIfExists: true },
      ),
    )
  }

  return { files: results }
}
