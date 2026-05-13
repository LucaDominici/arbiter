/**
 * Windsurf agent-rules emitter (#265).
 *
 * Output: `.windsurfrules`
 * Format: Text rules format (flat list).
 */

import type { AgentRulesIntermediate } from '../intermediate.js'

export function emitWindsurf(intermediate: AgentRulesIntermediate): string {
  const lines: string[] = []

  lines.push(`# ${intermediate.repo} Governance Rules`)
  lines.push('')
  lines.push('## Rules')
  lines.push('')

  for (const inv of intermediate.invariants) {
    const prefix = inv.severity === 'hard-stop' ? 'NEVER violate' : 'Follow'
    lines.push(`- ${prefix} ${inv.id}: ${inv.statement}`)
  }

  lines.push('')
  lines.push('## Workflows')
  lines.push('')
  for (const wf of intermediate.workflows) {
    lines.push(`- ${wf.trigger}: ${wf.action}`)
  }
  lines.push('')

  return lines.join('\n')
}
