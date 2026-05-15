// SPDX-License-Identifier: Apache-2.0
/**
 * ADR builder (#259, followup).
 *
 * Reads `docs/SYSTEM/DECISIONS.md` and emits:
 *   - one ADR node per `## <title> (<date>)` section
 *   - ADR --decides--> INV edges for INV-NN refs in **Reference:** lines
 *
 * DECISIONS.md format (no YAML frontmatter — confirmed by reading the actual file):
 *   ## feat(#NNN): title (YYYY-MM-DD)
 *   **Status:** Accepted
 *   **Reference:** Issue #NNN; INV-NN, INV-MM
 *   ...body...
 *   ---
 *
 * ADR node id: "ADR:<slug>" where slug is the heading normalised to stable alphanum form.
 *
 * Existing Code Survey (CANON-16):
 *   - no existing ADR parser found in src/
 *   - no YAML frontmatter needed (format confirmed from docs/SYSTEM/DECISIONS.md)
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GraphNode, GraphEdge } from '../model.js'
import { GraphStore } from '../store.js'
import { extractInvRefs } from './utils.js'

const DECISIONS_PATH = join('docs', 'SYSTEM', 'DECISIONS.md')

export interface BuildAdrOptions {
  source?: string
  /** Override path to DECISIONS.md (for tests). */
  decisionsPath?: string
}

export interface AdrEntry {
  id: string
  title: string
  status: string
  invRefs: string[]
}

/**
 * Parse DECISIONS.md into ADR entries.
 * Returns an empty array when the file is missing (builder degrades gracefully).
 */
export function parseDecisions(text: string): AdrEntry[] {
  const entries: AdrEntry[] = []
  // Split on `## ` headings that start a line
  const sections = text.split(/^(?=## )/m)
  for (const section of sections) {
    const headingMatch = /^## (.+)/.exec(section)
    if (headingMatch === null) continue
    const headingRaw = headingMatch[1]
    if (headingRaw === undefined) continue
    const heading = headingRaw.trim()
    // Only treat sections that look like decision entries (have Status or Reference)
    if (!section.includes('**Status:**') && !section.includes('**Reference:**')) continue

    const id = headingToAdrId(heading)
    const statusMatch = /\*\*Status:\*\*\s*(.+)/.exec(section)
    const statusRaw = statusMatch !== null ? statusMatch[1] : undefined
    const status = statusRaw !== undefined ? statusRaw.trim() : 'Unknown'

    // Collect INV refs from Reference lines
    const invRefs: string[] = []
    for (const line of section.split('\n')) {
      if (line.includes('**Reference:**') || line.includes('Reference:')) {
        invRefs.push(...extractInvRefs(line))
      }
    }

    entries.push({ id, title: heading, status, invRefs })
  }
  return entries
}

/**
 * Normalise a heading to a stable ADR node id.
 * e.g. "feat(#470): soloDevMode (2026-05-13)" -> "ADR:feat-#470-soloDevMode"
 */
function headingToAdrId(heading: string): string {
  // Strip trailing date in parens
  const withoutDate = heading.replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, '').trim()
  // Replace non-alnum (except # and -) with -; collapse multiple dashes
  const slug = withoutDate
    .replace(/[^\w#-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `ADR:${slug}`
}

export function buildAdrNodes(
  store: GraphStore = new GraphStore(),
  opts: BuildAdrOptions = {},
  projectRoot = '.',
): GraphStore {
  const source = opts.source ?? 'adr-builder'
  const decisionsFile =
    opts.decisionsPath !== undefined ? opts.decisionsPath : join(projectRoot, DECISIONS_PATH)

  if (!existsSync(decisionsFile)) {
    // Degrade gracefully — target projects may not have DECISIONS.md yet
    return store
  }

  let text: string
  try {
    text = readFileSync(decisionsFile, 'utf-8')
  } catch {
    return store
  }

  const entries = parseDecisions(text)

  for (const entry of entries) {
    const node: GraphNode = {
      id: entry.id,
      kind: 'ADR',
      attrs: {
        title: entry.title,
        status: entry.status,
        source,
      },
    }
    store.upsertNode(node)

    // ADR --decides--> INV edges
    for (const invId of entry.invRefs) {
      // Ensure the INV node exists (upsert a stub if not yet seeded by inv builder)
      if (!store.hasNode(invId)) {
        store.upsertNode({ id: invId, kind: 'INV', attrs: { source: 'adr-stub' } })
      }
      const edge: GraphEdge = {
        from: entry.id,
        to: invId,
        kind: 'decides',
        attrs: { source },
      }
      store.addEdge(edge)
    }
  }

  return store
}
