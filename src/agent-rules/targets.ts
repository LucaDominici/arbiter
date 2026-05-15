// SPDX-License-Identifier: Apache-2.0
/**
 * Agent-rules target registry (#265).
 *
 * Maps target names to their emitters and standard output paths.
 * Adding a new target requires adding an entry here.
 */

import type { AgentRulesIntermediate } from './intermediate.js'
import { emitClaude } from './emitters/claude.js'
import { emitCursor } from './emitters/cursor.js'
import { emitCopilot } from './emitters/copilot.js'
import { emitAider } from './emitters/aider.js'
import { emitWindsurf } from './emitters/windsurf.js'

export type AgentRulesTarget = 'claude' | 'cursor' | 'copilot' | 'aider' | 'windsurf'

export const ALL_TARGETS: readonly AgentRulesTarget[] = [
  'claude',
  'cursor',
  'copilot',
  'aider',
  'windsurf',
]

export function isAgentRulesTarget(value: string): value is AgentRulesTarget {
  return (ALL_TARGETS as readonly string[]).includes(value)
}

export interface TargetSpec {
  /** Standard relative output path within the repo. */
  outputPath: string
  /** Emit function: takes intermediate → content string. */
  emit: (intermediate: AgentRulesIntermediate) => string
}

export const TARGET_SPECS: Record<AgentRulesTarget, TargetSpec> = {
  claude: {
    outputPath: '.claude/AGENT_RULES.md',
    emit: emitClaude,
  },
  cursor: {
    outputPath: '.cursorrules',
    emit: emitCursor,
  },
  copilot: {
    outputPath: '.github/copilot-instructions.md',
    emit: emitCopilot,
  },
  aider: {
    outputPath: 'CONVENTIONS.md',
    emit: emitAider,
  },
  windsurf: {
    outputPath: '.windsurfrules',
    emit: emitWindsurf,
  },
}
