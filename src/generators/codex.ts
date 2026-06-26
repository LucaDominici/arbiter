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

  // Tool-agnostic subset of .claude/rules/ (skip if exists). The Claude track also
  // emits 40-context-economy, 55-brainstorm-terminal-state, and 75-impact-vault-reading
  // (plus conditional 45-mcp-fallback) — those are DELIBERATELY omitted here because
  // each is coupled to a Claude-only mechanism the Codex track does not generate:
  //   - 40 routes through `.claude/knowledge-map.json` (Claude artifact),
  //   - 55 is enforced by the `post-brainstorm-stop` hook + `/task` (Claude hooks/commands),
  //   - 75 drives the `/impact` skill + `graphify` + `pre-edit-plan-anchor` hook (Claude-only).
  // The exact delta is locked by a parity test in __tests__/tools/codex.test.ts so the two
  // tracks cannot drift further unnoticed (#1586). 05/25/50/60 are byte-identical to the
  // Claude rule files; 90 is a Codex-tailored exec protocol.
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
      file: '50-batch-execution.md',
      template: 'codex/rules/50-batch-execution.md',
    },
    {
      file: '60-incidental-capture.md',
      template: 'codex/rules/60-incidental-capture.md',
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
