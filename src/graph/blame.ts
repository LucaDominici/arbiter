// SPDX-License-Identifier: Apache-2.0
/**
 * Blame timeline builder and formatters for the provenance graph (#263).
 *
 * Pure functions over HistoryEvent[] — no I/O, deterministic.
 *
 * Existing Code Survey (CANON-16):
 *   - grep "export.*blame\|export.*Blame\|export.*timeline\|export.*Timeline" src/ — nothing
 *   - grep "formatText\|formatJson\|formatMermaid\|formatMarkdown" src/ — nothing in graph/
 *   - query.ts has toDot/toMermaid/toJson for GraphSnapshot — different domain (static graph)
 *   - Decision: new file justified — temporal timeline rendering is a distinct responsibility
 *
 * #263
 */

import type { HistoryEvent } from './history.js'

// ── Types ─────────────────────────────────────────────────────────────────

type TimelineEventKind = 'CREATED' | 'ENFORCED' | 'MODIFIED' | 'MENTIONED' | 'UNKNOWN'

export interface TimelineEntry {
  ts: string
  event: TimelineEventKind
  detail: string
  sha: string
}

export interface BlameTimeline {
  nodeId: string
  nodeTitle: string
  entries: TimelineEntry[]
  currentStatus: string
  complianceMappings?: ComplianceMapping[]
}

export interface ComplianceMapping {
  standard: string
  controlId: string
}

// ── Timeline builder ──────────────────────────────────────────────────────

// Keywords that suggest enforcement
const ENFORCE_KEYWORDS = ['enforce', 'gate', 'check', 'lint', 'hook', 'block', 'guard', 'prevent']

function classifyEvent(event: HistoryEvent, nodeId: string, isFirst: boolean): TimelineEventKind {
  if (isFirst) return 'CREATED'

  const text = [event.subject, event.notaryIntent ?? ''].join(' ').toLowerCase()

  for (const kw of ENFORCE_KEYWORDS) {
    if (text.includes(kw)) return 'ENFORCED'
  }

  // If the subject modifies or updates
  if (text.includes('update') || text.includes('modify') || text.includes('fix')) return 'MODIFIED'

  // If it merely references the node
  if (
    event.subject.includes(nodeId) ||
    (event.notaryIntent !== undefined && event.notaryIntent.includes(nodeId))
  ) {
    return 'MENTIONED'
  }

  return 'UNKNOWN'
}

function deriveCurrentStatus(entries: TimelineEntry[]): string {
  if (entries.length === 0) return 'UNKNOWN'

  // Walk from newest to oldest to find the best status
  const reversed = [...entries].reverse()
  for (const entry of reversed) {
    if (entry.event === 'ENFORCED') return 'ENFORCED'
    if (entry.event === 'CREATED') return 'ACTIVE'
  }
  return 'ACTIVE'
}

/**
 * Build a BlameTimeline from a list of HistoryEvents for a node.
 * Events must be pre-filtered for the node (see filterEventsForNode).
 */
export function buildTimeline(
  nodeId: string,
  nodeTitle: string,
  events: HistoryEvent[],
  complianceMappings?: ComplianceMapping[],
): BlameTimeline {
  const entries: TimelineEntry[] = events.map((event, idx) => {
    const isFirst = idx === 0
    const kind = classifyEvent(event, nodeId, isFirst)
    const detail =
      event.notaryIntent !== undefined
        ? `${event.notaryIntent} (commit ${event.sha.slice(0, 7)})`
        : `${event.subject} (commit ${event.sha.slice(0, 7)})`
    return {
      ts: event.ts.slice(0, 10), // Date portion only (YYYY-MM-DD)
      event: kind,
      detail,
      sha: event.sha.slice(0, 7),
    }
  })

  // Sort ascending by ts
  entries.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))

  const currentStatus = deriveCurrentStatus(entries)

  return {
    nodeId,
    nodeTitle,
    entries,
    currentStatus,
    ...(complianceMappings !== undefined ? { complianceMappings } : {}),
  }
}

// ── Formatters ────────────────────────────────────────────────────────────

/**
 * Text format — human-readable CLI output.
 *
 * Example:
 *   INV-01 — "No circular dependencies between modules"
 *
 *   Timeline:
 *     2024-11-03  CREATED    feat: add INV-01 (commit abc123)
 *
 *   Current:
 *     Status: ENFORCED
 */
export function formatText(timeline: BlameTimeline): string {
  const lines: string[] = []

  lines.push(`${timeline.nodeId} — "${timeline.nodeTitle}"`)
  lines.push('')

  if (timeline.entries.length > 0) {
    lines.push('Timeline:')
    for (const entry of timeline.entries) {
      const eventPad = entry.event.padEnd(10)
      lines.push(`  ${entry.ts}  ${eventPad}  ${entry.detail}`)
    }
  } else {
    lines.push('Timeline:')
    lines.push('  (no git history found for this node)')
  }

  lines.push('')
  lines.push('Current:')
  lines.push(`  Status: ${timeline.currentStatus}`)

  if (timeline.complianceMappings !== undefined && timeline.complianceMappings.length > 0) {
    lines.push('')
    lines.push('Compliance:')
    for (const mapping of timeline.complianceMappings) {
      lines.push(`  ${mapping.standard}: ${mapping.controlId}`)
    }
  }

  return lines.join('\n')
}

/**
 * JSON format — machine-readable output.
 */
export function formatJson(timeline: BlameTimeline): string {
  return JSON.stringify(timeline, null, 2)
}

/**
 * Mermaid timeline format.
 */
export function formatMermaid(timeline: BlameTimeline): string {
  const lines: string[] = []
  lines.push(`timeline`)
  lines.push(`  title ${timeline.nodeId} — ${timeline.nodeTitle}`)

  if (timeline.entries.length === 0) {
    lines.push('  section History')
    lines.push('    No history : No git history found')
    return lines.join('\n')
  }

  // Group by year
  const byYear = new Map<string, TimelineEntry[]>()
  for (const entry of timeline.entries) {
    const year = entry.ts.slice(0, 4)
    const existing = byYear.get(year)
    if (existing !== undefined) {
      existing.push(entry)
    } else {
      byYear.set(year, [entry])
    }
  }

  for (const [year, yearEntries] of byYear) {
    lines.push(`  section ${year}`)
    for (const entry of yearEntries) {
      const safeDetail = entry.detail.replace(/:/g, '-').slice(0, 60)
      lines.push(`    ${entry.ts} : ${entry.event} — ${safeDetail}`)
    }
  }

  return lines.join('\n')
}

/**
 * Markdown audit report format.
 *
 * Emits a structured markdown document with:
 *   - Heading with node id and title
 *   - Timeline table
 *   - Current status section
 *   - Optional compliance mapping table
 */
export function formatMarkdownAudit(timeline: BlameTimeline): string {
  const lines: string[] = []

  lines.push(`# Blame Report: ${timeline.nodeId}`)
  lines.push('')
  lines.push(`**Title:** ${timeline.nodeTitle}`)
  lines.push(`**Current Status:** ${timeline.currentStatus}`)
  lines.push('')

  lines.push('## Timeline')
  lines.push('')

  if (timeline.entries.length === 0) {
    lines.push('_No git history found for this node._')
  } else {
    lines.push('| Date | Event | Detail | SHA |')
    lines.push('|------|-------|--------|-----|')
    for (const entry of timeline.entries) {
      const safeDetail = entry.detail.replace(/\|/g, '\\|')
      lines.push(`| ${entry.ts} | ${entry.event} | ${safeDetail} | \`${entry.sha}\` |`)
    }
  }

  if (timeline.complianceMappings !== undefined && timeline.complianceMappings.length > 0) {
    lines.push('')
    lines.push('## Compliance Mappings')
    lines.push('')
    lines.push('| Standard | Control ID |')
    lines.push('|----------|------------|')
    for (const mapping of timeline.complianceMappings) {
      lines.push(`| ${mapping.standard} | ${mapping.controlId} |`)
    }
  }

  return lines.join('\n')
}
