// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface AgentsClaudeGeneratorResult {
  files: WriteResult[]
}

const AGENT_NAMES = ['codebase-scanner', 'red-team', 'context-checker', 'bridge-reviewer'] as const

export function generateAgentsClaude(config: ProjectConfig): AgentsClaudeGeneratorResult {
  if (!config.tools.includes('claude')) return { files: [] }

  const data = config
  const base = config.targetDir

  const files = AGENT_NAMES.map((name) =>
    writeFile(
      resolvedPath(base, '.claude', 'agents', `${name}.md`),
      renderTemplate(`claude/agents/${name}.md.ejs`, data),
      { skipIfExists: true },
    ),
  )

  return { files }
}
