// SPDX-License-Identifier: Apache-2.0
/**
 * REQ builder (#259, followup).
 *
 * Reads FEATURE_MATRIX.md and/or REQUIREMENTS_MATRIX.md from the project root
 * and emits REQ nodes. These files may not exist in many projects — builder
 * degrades gracefully (returns store unchanged).
 *
 * Format heuristic: look for rows in markdown tables like:
 *   | REQ-001 | title | ... |
 * or headings like:
 *   ## REQ-001: title
 *
 * Existing Code Survey (CANON-16):
 *   - no existing REQ/matrix parser found in src/
 *   - FEATURE_MATRIX.md does not exist in arbiter itself
 *   - new file justified: entirely new domain (requirement nodes)
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GraphNode } from '../model.js'
import { GraphStore } from '../store.js'

const CANDIDATE_FILES = ['FEATURE_MATRIX.md', 'REQUIREMENTS_MATRIX.md']

export interface BuildReqOptions {
  source?: string
  /** Override candidate files (for tests). */
  files?: string[]
}

export interface ReqEntry {
  id: string
  title: string
  sourceFile: string
}

/** Extract REQ entries from a markdown text. */
export function parseReqText(text: string, sourceFile: string): ReqEntry[] {
  const entries: ReqEntry[] = []
  const seen = new Set<string>()

  for (const line of text.split('\n')) {
    // Match table rows: | REQ-NNN | title | ...
    const tableMatch = /^\s*\|\s*(REQ-\d+)\s*\|\s*([^|]+)/.exec(line)
    if (tableMatch !== null) {
      const idRaw = tableMatch[1]
      const titleRaw = tableMatch[2]
      if (idRaw === undefined || titleRaw === undefined) continue
      const id = idRaw.trim()
      const title = titleRaw.trim()
      if (!seen.has(id)) {
        seen.add(id)
        entries.push({ id, title, sourceFile })
      }
      continue
    }

    // Match headings: ## REQ-NNN: title  or  ## REQ-NNN - title
    const headingMatch = /^#{1,3}\s+(REQ-\d+)[:\s-]+(.+)/.exec(line)
    if (headingMatch !== null) {
      const idRaw = headingMatch[1]
      const titleRaw = headingMatch[2]
      if (idRaw === undefined || titleRaw === undefined) continue
      const id = idRaw.trim()
      const title = titleRaw.trim()
      if (!seen.has(id)) {
        seen.add(id)
        entries.push({ id, title, sourceFile })
      }
    }
  }

  return entries
}

export function buildReqNodes(
  store: GraphStore = new GraphStore(),
  opts: BuildReqOptions = {},
  projectRoot = '.',
): GraphStore {
  const source = opts.source ?? 'req-builder'
  const candidateFiles = opts.files ?? CANDIDATE_FILES.map((f) => join(projectRoot, f))

  for (const filePath of candidateFiles) {
    if (!existsSync(filePath)) continue

    let text: string
    try {
      text = readFileSync(filePath, 'utf-8')
    } catch {
      continue
    }

    const entries = parseReqText(text, filePath)
    for (const entry of entries) {
      const node: GraphNode = {
        id: entry.id,
        kind: 'REQ',
        attrs: {
          title: entry.title,
          sourceFile: entry.sourceFile,
          source,
        },
      }
      store.upsertNode(node)
    }
  }

  return store
}
