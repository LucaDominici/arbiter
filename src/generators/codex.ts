// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { generateCodexHooks } from './codex-hooks.js'
import { buildKnownLimitations, CODEX_DERIVED_RULES } from './codex-known-limitations.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface CodexGeneratorResult {
  files: WriteResult[]
}

export function generateCodex(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): CodexGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir
  // knownLimitations is GENERATED from the actual Claude-track inventory
  // (ADR-106): the CODEX.md table cannot silently go stale again (#1966).
  const data = { ...config, knownLimitations: buildKnownLimitations(config) }

  // CODEX.md — thin pointer + Codex-specific config
  results.push(
    writeFile(
      resolvedPath(base, '.agents', 'CODEX.md'),
      renderTemplate('codex/CODEX.md.ejs', data),
      { backup: true, dryRun: opts.dryRun },
    ),
  )

  // Tool-agnostic subset of rules, DERIVED from the canonical Claude rule
  // templates (ADR-106 derive-from-Claude: src/templates/claude/rules/ is the
  // single source; the parallel codex copies were removed in #1966 after the
  // Codex 90-exec-protocol silently lost the CANON-22 section). The deliberate
  // Claude-only delta (40/55/75/95 + conditional 45) is documented on
  // CODEX_DERIVED_RULES and locked by __tests__/tools/codex.test.ts (#1586)
  // plus the check-codex-parity gate.
  const rulesDir = resolvedPath(base, '.agents', 'rules')
  for (const rule of CODEX_DERIVED_RULES) {
    results.push(
      writeFile(join(rulesDir, rule.file), renderTemplate(rule.template, data), {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
    )
  }

  // Plan directory scaffold
  const planDir = resolvedPath(base, '.agents', 'plan')
  results.push(
    writeFile(join(planDir, 'README.md'), PLAN_README, { skipIfExists: true, dryRun: opts.dryRun }),
  )

  // Hook parity — .codex/config.toml + codex-adapter.mjs
  const hookResult = generateCodexHooks(config, opts)
  results.push(...hookResult.files)

  return { files: results }
}

const PLAN_README = `# .agents/plan/

Task plan artifacts for Codex execution.

## Files

- \`PLAN.json\` — current task plan (created by Codex before implementation)
- \`CONTEXT_PACK.md\` — context digest for the current task
- \`runs/\` — historical run snapshots

## Plan Schema

See \`.agents/CODEX.md\` §Plan Schema for the required format.
`
