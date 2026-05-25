// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface DocsGeneratorResult {
  files: WriteResult[]
}

export function generateDocs(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): DocsGeneratorResult {
  if (config.governanceLevel === 'L1') {
    return { files: [] }
  }

  const results: WriteResult[] = []
  const base = config.targetDir
  const data = config
  const adrDir = resolvedPath(base, join('docs', 'adr'))

  results.push(
    writeFile(
      join(adrDir, 'ADR-000_template.md'),
      renderTemplate('docs/adr/ADR-000_template.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  results.push(
    writeFile(
      resolvedPath(base, 'docs', 'SECURE_CODING_CHECKLIST.md'),
      renderTemplate('docs/SECURE_CODING_CHECKLIST.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  results.push(
    writeFile(
      resolvedPath(base, 'docs', 'CODING_STANDARDS.md'),
      renderTemplate('docs/CODING_STANDARDS.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  results.push(
    writeFile(
      resolvedPath(base, 'docs', 'MASTER_TEST_PLAN.md'),
      renderTemplate('docs/MASTER_TEST_PLAN.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  results.push(
    writeFile(
      resolvedPath(base, 'docs', 'testing', 'POST_MERGE_REVIEW_TEMPLATE.md'),
      renderTemplate('docs/POST_MERGE_REVIEW_TEMPLATE.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  if (config.governanceLevel === 'L3') {
    results.push(
      writeFile(
        resolvedPath(base, 'docs', 'SECURITY', 'ISO27001_ANNEX_A.md'),
        renderTemplate('docs/ISO27001_ANNEX_A.md.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  results.push(
    writeFile(
      resolvedPath(base, 'docs', 'COMMANDS.md'),
      renderTemplate('documentation/cli-catalog.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  // F12: docs/runbooks/ scaffold — operational runbooks (KIT dim 68, M3 REFERENCE)
  const runbooksDir = resolvedPath(base, 'docs', 'runbooks')
  for (const runbook of ['rollback', 'troubleshooting', 'prod-checklist', 'deployment']) {
    results.push(
      writeFile(
        resolvedPath(runbooksDir, `${runbook}.md`),
        renderTemplate(`docs/runbooks/${runbook}.md.ejs`, data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  // F12: docs/security/ scaffold — STRIDE threat model (KIT dim 66, M3 REFERENCE, L2+)
  results.push(
    writeFile(
      resolvedPath(base, 'docs', 'security', 'STRIDE.md'),
      renderTemplate('security/STRIDE.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  // F12: docs/security/ scaffold — risk assessment (KIT dim 66, M3 REFERENCE, L3 only)
  if (config.governanceLevel === 'L3') {
    results.push(
      writeFile(
        resolvedPath(base, 'docs', 'security', 'RISK_ASSESSMENT.md'),
        renderTemplate('security/RISK_ASSESSMENT.md.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  return { files: results }
}
