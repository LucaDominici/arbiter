// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface SecurityGeneratorResult {
  files: WriteResult[]
}

function renderSecurityTemplate(templatePath: string, data: object): string {
  try {
    return renderTemplate(templatePath, data)
  } catch (err) {
    throw new Error(
      `security.ts: template not found or failed to render at ${templatePath} — check installation`,
      { cause: err },
    )
  }
}

export function generateSecurity(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): SecurityGeneratorResult {
  if (!config.enableSecurityScanning) return { files: [] }

  const base = config.targetDir
  const data = config
  const results: WriteResult[] = []

  // PII scanner — always runs early-fail (HARD, no grace)
  results.push(
    writeFile(
      resolvedPath(base, 'scripts', 'pii-scan.mjs'),
      renderSecurityTemplate('scripts/pii-scan.mjs.ejs', data),
      { skipIfExists: false, dryRun: opts.dryRun },
    ),
  )

  // Gitleaks config — references .gitleaksignore suppression file
  results.push(
    writeFile(
      resolvedPath(base, '.gitleaks.toml'),
      renderSecurityTemplate('security/gitleaks.toml.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  // Claude hook: block PII in edited files (PostToolUse) — skip when ai-rulez manages .claude/
  if (!config.existing.aiRulez) {
    results.push(
      writeFile(
        resolvedPath(base, '.claude', 'hooks', 'check-no-pii.mjs'),
        renderSecurityTemplate('claude/hooks/check-no-pii.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  // ZAP DAST files — service archetype only (backend-web-db runs a live server)
  // M3 advisory: rules.tsv, baseline-auth.context, ingest-zap-report.mjs (#898)
  if (config.archetype === 'backend-web-db') {
    // rules.tsv is user-tunable (IGNORE entries for false positives) — never overwrite,
    // mirrors the gitleaks.toml pattern for suppression files
    results.push(
      writeFile(
        resolvedPath(base, '.zap', 'rules.tsv'),
        renderSecurityTemplate('security/zap/rules.tsv.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    // baseline-auth.context is user-customised (login URL, credentials) — never overwrite
    results.push(
      writeFile(
        resolvedPath(base, '.zap', 'baseline-auth.context'),
        renderSecurityTemplate('security/zap/baseline-auth.context.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    // Ingest script is generated code — always kept current
    results.push(
      writeFile(
        resolvedPath(base, 'scripts', 'ingest-zap-report.mjs'),
        renderSecurityTemplate('scripts/ingest-zap-report.mjs.ejs', data),
        { skipIfExists: false, dryRun: opts.dryRun },
      ),
    )
  }

  return { files: results }
}
