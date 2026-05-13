/**
 * Cursor agent-rules emitter (#265).
 *
 * Output: `.cursorrules`
 * Format: Cursor rules format (markdown-like plain text).
 */

import type { AgentRulesIntermediate } from '../intermediate.js'

export function emitCursor(intermediate: AgentRulesIntermediate): string {
  const lines: string[] = []

  lines.push(`# ${intermediate.repo} — Governance Rules (Cursor)`)
  lines.push('')
  lines.push('## Invariants')
  lines.push('')

  const mandatory = intermediate.invariants.filter((i) => i.severity === 'hard-stop')
  const advisory = intermediate.invariants.filter((i) => i.severity === 'advisory')

  if (mandatory.length > 0) {
    lines.push('### Hard-stop rules (violations block the task)')
    lines.push('')
    for (const inv of mandatory) {
      lines.push(`- **${inv.id}**: ${inv.statement}`)
    }
    lines.push('')
  }

  if (advisory.length > 0) {
    lines.push('### Advisory rules (follow unless explicitly justified)')
    lines.push('')
    for (const inv of advisory) {
      lines.push(`- ${inv.id}: ${inv.statement}`)
    }
    lines.push('')
  }

  lines.push('## Workflows')
  lines.push('')
  for (const wf of intermediate.workflows) {
    lines.push(`- ${wf.trigger}: ${wf.action}`)
  }
  lines.push('')

  return lines.join('\n')
}
