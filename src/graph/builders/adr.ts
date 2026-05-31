// SPDX-License-Identifier: Apache-2.0
/**
 * ADR builder — reads docs/ADR/NNN-*.md per-file SSOT (Wave 2 migration).
 *
 * Each ADR file carries YAML frontmatter:
 *   canonical_id: 'NNN'
 *   title: 'ADR-NNN: ...'
 *   status: active | superseded | proposed
 *
 * ADR node id: "ADR:NNN" (3-digit canonical_id).
 * Edges: ADR --decides--> INV for every INV-NN ref found in **Reference:** lines.
 *
 * Existing Code Survey (CANON-16, Wave 2 rewrite):
 *   - prior impl read docs/SYSTEM/DECISIONS.md (section-heading format)
 *   - repointed to docs/ADR/ per-file YAML in Wave 2 (ADR-073, issue #1099)
 *   - DECISIONS.md frozen as legacy; graph.json now reflects per-file SSOT
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { GraphNode, GraphEdge } from '../model.js'
import { GraphStore } from '../store.js'
import { extractInvRefs } from './utils.js'

const ADR_DIR = join('docs', 'ADR')
const NUMBERED_FILE_RE = /^(\d{3})-.+\.md$/

export interface BuildAdrOptions {
  source?: string
  /** Override path to docs/ADR/ directory (for tests). */
  adrDir?: string
}

export interface AdrEntry {
  id: string
  title: string
  status: string
  invRefs: string[]
}

/** Parse YAML frontmatter (between --- delimiters) into a key-value map. */
export function parseFrontmatter(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(text)
  if (match === null) return {}
  const block = match[1]
  if (block === undefined) return {}
  const fm: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const raw = line.slice(colon + 1).trim()
    fm[key] = raw.replace(/^['"]|['"]$/g, '')
  }
  return fm
}

/**
 * Parse a docs/ADR/NNN-*.md file into an AdrEntry.
 * Returns null when canonical_id is missing or non-numeric.
 */
export function parseAdrFile(text: string): AdrEntry | null {
  const fm = parseFrontmatter(text)
  const canonicalId = fm['canonical_id']
  if (canonicalId === undefined || canonicalId === '') return null
  if (!/^\d+$/.test(canonicalId)) return null

  const id = `ADR:${canonicalId}`
  const title = fm['title'] ?? ''
  const status = fm['status'] ?? 'Unknown'

  const invRefs: string[] = []
  for (const line of text.split('\n')) {
    if (line.includes('**Reference:**') || line.includes('Reference:')) {
      invRefs.push(...extractInvRefs(line))
    }
  }

  return { id, title, status, invRefs }
}

export function buildAdrNodes(
  store: GraphStore = new GraphStore(),
  opts: BuildAdrOptions = {},
  projectRoot = '.',
): GraphStore {
  const source = opts.source ?? 'adr-builder'
  const adrDirectory = opts.adrDir !== undefined ? opts.adrDir : join(projectRoot, ADR_DIR)

  if (!existsSync(adrDirectory)) {
    return store
  }

  let fileNames: string[]
  try {
    fileNames = readdirSync(adrDirectory)
      .filter((f) => NUMBERED_FILE_RE.test(f))
      .sort()
  } catch {
    return store
  }

  for (const fileName of fileNames) {
    let text: string
    try {
      text = readFileSync(join(adrDirectory, fileName), 'utf-8')
    } catch {
      continue
    }

    const entry = parseAdrFile(text)
    if (entry === null) continue

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

    for (const invId of entry.invRefs) {
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
