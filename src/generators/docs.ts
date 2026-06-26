// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface DocsGeneratorResult {
  files: WriteResult[]
}

/**
 * #1268: spec-kit template families (re-derived). Steering docs (durable project
 * context an agent reads before working), atomic-task-list (feature decomposition),
 * and bug triage/verification (companions to the auto-generated DEBUG_STATE.md).
 * Extracted from {@link generateDocs} to keep that function within the
 * method-length ceiling (CANON-22 root-cause discipline).
 */
function emitSpecKitFamilies(config: ProjectConfig, opts: { dryRun: boolean }): WriteResult[] {
  const base = config.targetDir
  const out: WriteResult[] = []

  for (const steering of ['structure', 'tech', 'product']) {
    out.push(
      writeFile(
        resolvedPath(base, 'docs', 'steering', `${steering}.md`),
        renderTemplate(`docs/steering/${steering}.md.ejs`, config),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  out.push(
    writeFile(
      resolvedPath(base, 'docs', 'specs', 'atomic-task-list.md'),
      renderTemplate('docs/specs/atomic-task-list.md.ejs', config),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  for (const bug of ['bug-report', 'bug-analysis', 'bug-verification']) {
    out.push(
      writeFile(
        resolvedPath(base, 'docs', 'bugs', `${bug}.md`),
        renderTemplate(`docs/bugs/${bug}.md.ejs`, config),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  return out
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

  // #1578/#1592: docs/SECURITY/STRIDE.md is emitted solely by the purpose-built
  // stride-enforcement generator (which also owns the check-stride-traceability gate
  // that parses it). docs.ts previously emitted a second copy to the same path with
  // identical L2+ gating; once #1592 unified the casing to uppercase SECURITY the two
  // writes collapsed onto one key and the #1578 no-double-emit guard fired. Dropping
  // the duplicate here leaves stride-enforcement as the sole emitter — the emission
  // surface is unchanged (STRIDE.md is still produced at L2/L3/L4).

  // F12: docs/SECURITY/ scaffold — risk assessment (KIT dim 66, M3 REFERENCE, L3 only)
  if (config.governanceLevel === 'L3') {
    results.push(
      writeFile(
        resolvedPath(base, 'docs', 'SECURITY', 'RISK_ASSESSMENT.md'),
        renderTemplate('security/RISK_ASSESSMENT.md.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  // #1268: spec-kit template families (steering / atomic-task-list / bug triage).
  results.push(...emitSpecKitFamilies(config, opts))

  return { files: results }
}
