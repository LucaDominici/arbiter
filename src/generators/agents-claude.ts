// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface AgentsClaudeGeneratorResult {
  files: WriteResult[]
}

// Exported for codex-known-limitations.ts (ADR-106): the Claude-only agent
// inventory in CODEX.md is derived from this list, never hand-maintained.
export const AGENT_NAMES = [
  'codebase-scanner',
  'red-team',
  'context-checker',
  'bridge-reviewer',
] as const

export function generateAgentsClaude(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): AgentsClaudeGeneratorResult {
  if (!config.tools.includes('claude')) return { files: [] }

  const data = config
  const base = config.targetDir

  const files = AGENT_NAMES.map((name) =>
    writeFile(
      resolvedPath(base, '.claude', 'agents', `${name}.md`),
      renderTemplate(`claude/agents/${name}.md.ejs`, data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  return { files }
}
