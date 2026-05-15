// SPDX-License-Identifier: Apache-2.0
/**
 * Heading-diff detector: given two versions of a markdown file,
 * emits a list of changed sections (add/modify/delete + line deltas).
 *
 * Existing Code Survey (CANON-16):
 *   - grep for "export.*delta\|export.*Delta" src/ --include="*.ts" -l — no matches
 *   - grep for "heading.*diff\|section.*diff" src/ --include="*.ts" -l — no matches
 *   - Decision: new file justified — no similar heading-diff logic exists in src/
 *
 * #256
 */

export type SectionChangeType = 'add' | 'modify' | 'delete' | 'move'

export interface SectionDelta {
  /** Section heading text (without # prefix) */
  section: string
  type: SectionChangeType
  /** Lines added in this section */
  added: number
  /** Lines removed from this section */
  removed: number
}

interface Section {
  heading: string
  lines: string[]
}

/**
 * Parse markdown into sections keyed by heading.
 * Each section captures all non-heading lines until the next heading.
 */
function parseSections(md: string): Map<string, Section> {
  const result = new Map<string, Section>()
  const lines = md.split('\n')
  let currentHeading = ''
  let currentLines: string[] = []

  const headingRe = /^#{1,6}\s+(.+)/

  for (const line of lines) {
    const match = headingRe.exec(line)
    if (match) {
      if (currentHeading) {
        result.set(currentHeading, { heading: currentHeading, lines: currentLines })
      }
      currentHeading = (match[1] ?? '').trim()
      currentLines = []
    } else {
      currentLines.push(line)
    }
  }

  if (currentHeading) {
    result.set(currentHeading, { heading: currentHeading, lines: currentLines })
  }

  return result
}

/**
 * Compute how many lines were added and removed between two string arrays.
 */
function lineDelta(before: string[], after: string[]): { added: number; removed: number } {
  // Normalize: strip blank lines for comparison
  const b = before.filter((l) => l.trim() !== '')
  const a = after.filter((l) => l.trim() !== '')

  // Simple set-based diff — lines present in after but not before = added
  const beforeSet = new Set(b)
  const afterSet = new Set(a)

  const added = a.filter((l) => !beforeSet.has(l)).length
  const removed = b.filter((l) => !afterSet.has(l)).length
  return { added, removed }
}

/**
 * Given two markdown strings (before/after), return the list of section
 * changes. Only headings with different body content (or presence) are listed.
 */
export function diffMarkdownSections(before: string, after: string): SectionDelta[] {
  const beforeSections = parseSections(before)
  const afterSections = parseSections(after)

  const deltas: SectionDelta[] = []

  // Detect added + modified sections
  for (const [heading, afterSection] of afterSections) {
    const beforeSection = beforeSections.get(heading)
    if (!beforeSection) {
      // New section
      deltas.push({ section: heading, type: 'add', added: afterSection.lines.length, removed: 0 })
    } else {
      // Check if content changed
      const { added, removed } = lineDelta(beforeSection.lines, afterSection.lines)
      if (added > 0 || removed > 0) {
        deltas.push({ section: heading, type: 'modify', added, removed })
      }
    }
  }

  // Detect deleted sections
  for (const [heading, beforeSection] of beforeSections) {
    if (!afterSections.has(heading)) {
      deltas.push({
        section: heading,
        type: 'delete',
        added: 0,
        removed: beforeSection.lines.length,
      })
    }
  }

  return deltas
}
