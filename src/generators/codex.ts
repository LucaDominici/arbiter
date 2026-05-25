// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { generateCodexHooks } from './codex-hooks.js'
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
  const data = config

  // CODEX.md — thin pointer + Codex-specific config
  results.push(
    writeFile(
      resolvedPath(base, '.agents', 'CODEX.md'),
      renderTemplate('codex/CODEX.md.ejs', data),
      { backup: true, dryRun: opts.dryRun },
    ),
  )

  // Rules mirror — same as .claude/rules/ (skip if exists)
  const rulesDir = resolvedPath(base, '.agents', 'rules')
  const rules = [
    {
      file: '05-agent-lifecycle.md',
      template: 'codex/rules/05-agent-lifecycle.md',
    },
    {
      file: '25-todo-folder-policy.md',
      template: 'codex/rules/25-todo-folder-policy.md',
    },
    {
      file: '90-exec-protocol.md',
      template: 'codex/rules/90-exec-protocol.md.ejs',
    },
  ]
  for (const rule of rules) {
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
