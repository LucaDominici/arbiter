// SPDX-License-Identifier: Apache-2.0
/**
 * Renders the KIT self-audit report as deterministic Markdown.
 *
 * No timestamps, no hostname, no env-derived values — same input
 * produces byte-identical output on every call (required for E5 canary diff).
 *
 * Issue: #1043
 */

import type { WavePlan } from './wave-engine.js'

const STATUS_BADGE: Record<string, string> = {
  present: 'PRESENT',
  partial: 'PARTIAL',
  missing: 'MISSING',
}

export function renderAuditMarkdown(
  measurements: Record<string, { status: 'present' | 'partial' | 'missing'; evidence: string[] }>,
  wavePlan: WavePlan,
  applicabilityReasons: Record<string, string>,
): string {
  const lines: string[] = []

  lines.push('# SELF-KIT Audit Report')
  lines.push('')
  lines.push(`Brownfield class: **${wavePlan.brownfieldClass}**`)
  lines.push('')

  for (const wave of wavePlan.waves) {
    lines.push(`## ${wave.label} — ${wave.goal}`)
    lines.push('')

    if (wave.dimensions.length === 0) {
      lines.push('_No dimensions in this wave._')
      lines.push('')
      continue
    }

    lines.push('| Dim | Status | Evidence |')
    lines.push('|-----|--------|----------|')

    for (const entry of wave.dimensions) {
      const m = measurements[entry.dimId]
      const status = m ? (STATUS_BADGE[m.status] ?? m.status) : 'MISSING'
      const evidence = m ? m.evidence.join(', ') : ''
      const reason = applicabilityReasons[entry.dimId]
      const naNote = reason ? ` _(NA: ${reason})_` : ''
      lines.push(`| ${entry.dimId} | ${status}${naNote} | ${evidence} |`)
    }
    lines.push('')
  }

  const naEntries = Object.entries(applicabilityReasons).filter(
    ([id]) => !wavePlan.waves.some((w) => w.dimensions.some((d) => d.dimId === id)),
  )
  if (naEntries.length > 0) {
    lines.push('## N/A Dimensions')
    lines.push('')
    lines.push('| Dim | Reason |')
    lines.push('|-----|--------|')
    for (const [id, reason] of naEntries.sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`| ${id} | ${reason} |`)
    }
    lines.push('')
  }

  lines.push(`Summary: ${wavePlan.summary.totalDims} dims total`)
  lines.push('')

  return lines.join('\n')
}
