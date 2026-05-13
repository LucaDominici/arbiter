/**
 * CANON builder (#259, followup).
 *
 * Reads `docs/SYSTEM/CANON.md` and emits:
 *   - one CANON node per `## CANON-NN` section
 *   - CANON --promotes--> INV edges for "Promoted to: INV-NN" footers
 *
 * CANON.md format:
 *   ## CANON-NN -- Rule Title
 *   **Rule:** ...
 *   **Promoted to:** INV-NN    (optional - only for graduated rules)
 *
 * CANON node id: "CANON-NN" (e.g. "CANON-16")
 *
 * Existing Code Survey (CANON-16):
 *   - no existing CANON.md parser found in src/
 *   - new file justified: new domain (canon rule harvesting)
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GraphNode, GraphEdge } from '../model.js'
import { GraphStore } from '../store.js'

const CANON_MD_PATH = join('docs', 'SYSTEM', 'CANON.md')
const CANON_HEADING_RE = /^## (CANON-\d+)\s*(?:[—-]+)?\s*(.*)/
const PROMOTED_TO_RE = /\*\*Promoted to:\*\*\s*(INV-\d+)/

export interface BuildCanonOptions {
  source?: string
  /** Override path to CANON.md (for tests). */
  canonPath?: string
}

export interface CanonEntry {
  id: string
  title: string
  promotedTo: string | null
}

/** Parse CANON.md text into CANON entries. */
export function parseCanon(text: string): CanonEntry[] {
  const entries: CanonEntry[] = []
  const sections = text.split(/^(?=## CANON-)/m)

  for (const section of sections) {
    const headingMatch = CANON_HEADING_RE.exec(section)
    if (headingMatch === null) continue

    const idRaw = headingMatch[1]
    const ruleTitleRaw = headingMatch[2]
    if (idRaw === undefined || ruleTitleRaw === undefined) continue
    const id = idRaw.trim()
    const ruleTitle = ruleTitleRaw.trim()

    const promotedMatch = PROMOTED_TO_RE.exec(section)
    const promotedRaw = promotedMatch !== null ? promotedMatch[1] : undefined
    const promotedTo = promotedRaw !== undefined ? promotedRaw.trim() : null

    entries.push({ id, title: ruleTitle, promotedTo })
  }

  return entries
}

export function buildCanonNodes(
  store: GraphStore = new GraphStore(),
  opts: BuildCanonOptions = {},
  projectRoot = '.',
): GraphStore {
  const source = opts.source ?? 'canon-builder'
  const canonFile = opts.canonPath !== undefined ? opts.canonPath : join(projectRoot, CANON_MD_PATH)

  if (!existsSync(canonFile)) return store

  let text: string
  try {
    text = readFileSync(canonFile, 'utf-8')
  } catch {
    return store
  }

  const entries = parseCanon(text)

  for (const entry of entries) {
    const node: GraphNode = {
      id: entry.id,
      kind: 'CANON',
      attrs: {
        title: entry.title,
        promotedTo: entry.promotedTo ?? null,
        source,
      },
    }
    store.upsertNode(node)

    if (entry.promotedTo !== null) {
      const invId = entry.promotedTo
      if (!store.hasNode(invId)) {
        store.upsertNode({ id: invId, kind: 'INV', attrs: { source: 'canon-stub' } })
      }
      const edge: GraphEdge = {
        from: entry.id,
        to: invId,
        kind: 'promotes',
        attrs: { source },
      }
      store.addEdge(edge)
    }
  }

  return store
}
