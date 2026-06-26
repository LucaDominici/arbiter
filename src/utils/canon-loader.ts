// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'

export interface CanonEntry {
  id: string
  title: string
  rule: string
  why: string
  enforcement: string
  sourceIssues?: string
  promotedTo?: string
}

/**
 * Parse docs/SYSTEM/CANON.md into structured entries.
 * Each entry starts at a `## CANON-NN — Title` heading.
 */
export function loadCanonEntries(canonMdPath: string): CanonEntry[] {
  let raw: string
  try {
    raw = readFileSync(canonMdPath, 'utf-8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return []
    throw new Error(
      `Failed to read CANON.md at ${canonMdPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }

  const entries: CanonEntry[] = []
  const sections = raw.split(/\n(?=## CANON-\d+)/)

  for (const section of sections) {
    const headerMatch = section.match(/^## (CANON-\d+) — (.+)/)
    if (!headerMatch) continue

    const id = headerMatch[1] ?? ''
    const title = (headerMatch[2] ?? '').trim()

    const entry: CanonEntry = {
      id,
      title,
      rule: extractField(section, 'Rule'),
      why: extractField(section, 'Why'),
      enforcement: extractField(section, 'Enforcement'),
    }
    const si = extractOptionalField(section, 'Source issues')
    if (si !== undefined) entry.sourceIssues = si
    const pt = extractOptionalField(section, 'Promoted to')
    if (pt !== undefined) entry.promotedTo = pt
    entries.push(entry)
  }

  return entries
}

function extractField(section: string, fieldName: string): string {
  // Every caller passes a compile-time string literal, so fieldName carries no
  // regex metacharacters today. Escape it defensively anyway so a future dynamic
  // caller cannot inject metacharacters into the compiled pattern (#1551,
  // defensive hygiene — not exploitable as written).
  const safeField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `\\*\\*${safeField}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*|\\n---\\n|$)`,
    'i',
  )
  const match = section.match(pattern)
  return match ? (match[1] ?? '').trim() : ''
}

function extractOptionalField(section: string, fieldName: string): string | undefined {
  const value = extractField(section, fieldName)
  return value.length > 0 ? value : undefined
}
