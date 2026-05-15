// SPDX-License-Identifier: Apache-2.0
/**
 * Markdown report renderer for cross-repo comparison (#264).
 *
 * Produces a human-readable summary of comparison findings grouped
 * into the five canonical sections.
 */

import type { CompareFinding, RepoData } from './model.js'

export interface ReportData {
  readonly repos: readonly RepoData[]
  readonly findings: readonly CompareFinding[]
  readonly warnings: readonly string[]
}

export function renderCompareReport(data: ReportData): string {
  const lines: string[] = []

  lines.push('# Cross-Repo Governance Comparison')
  lines.push('')
  lines.push(`**Repos compared:** ${data.repos.map((r) => r.label).join(', ')}`)
  lines.push(`**Total findings:** ${data.findings.length}`)
  if (data.warnings.length > 0) {
    lines.push('')
    lines.push('## Warnings')
    for (const w of data.warnings) {
      lines.push(`- ${w}`)
    }
  }
  lines.push('')

  const sections: Array<{ type: CompareFinding['type']; heading: string }> = [
    {
      type: 'divergent-enforcement',
      heading: 'Shared Invariants — Divergent Enforcement',
    },
    { type: 'contradictory-adr', heading: 'Contradictory ADRs' },
    {
      type: 'promotion-asymmetry',
      heading: 'Promotion Asymmetry (INV in one repo, absent in another)',
    },
    {
      type: 'unique-to-one-repo',
      heading: 'Unique to One Repo (org-wide promotion candidates)',
    },
    {
      type: 'risk-class-divergence',
      heading: 'Risk-Class Mapping Divergence',
    },
  ]

  for (const { type, heading } of sections) {
    const section = data.findings.filter((f) => f.type === type)
    lines.push(`## ${heading}`)
    lines.push('')
    if (section.length === 0) {
      lines.push('_No findings._')
    } else {
      for (const finding of section) {
        appendFinding(lines, finding)
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

function appendFinding(lines: string[], finding: CompareFinding): void {
  lines.push(`### ${finding.invId}`)
  lines.push('')
  lines.push(finding.summary)
  if (finding.detail !== undefined && finding.detail.length > 0) {
    lines.push('')
    for (const d of finding.detail) {
      lines.push(d)
    }
  }
  lines.push('')
}
