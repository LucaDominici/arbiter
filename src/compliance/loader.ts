// SPDX-License-Identifier: Apache-2.0
/**
 * Optional compliance mapping loader (#263).
 *
 * Reads `.arbiter/compliance.yaml` (if present) and returns the control IDs
 * mapped to a given node id. Returns undefined when no mapping file exists.
 *
 * compliance.yaml format:
 *   INV-01:
 *     - standard: SOC2
 *       controlId: CC6.1
 *     - standard: ISO27001
 *       controlId: A.14.2.1
 *
 * Existing Code Survey (CANON-16):
 *   - grep "export.*compliance\|export.*Compliance\|export.*loader" src/ — nothing
 *   - Decision: new file justified — no compliance mapping loader exists in src/
 *
 * #263
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ComplianceMapping } from '../graph/blame.js'

export const COMPLIANCE_RELATIVE_PATH = join('.arbiter', 'compliance.yaml')

const TOP_KEY_RE = /^([A-Z][A-Z0-9_-]*):$/
const LIST_ITEM_RE = /^\s+-\s+standard:\s+(.+)$/
const CONTROL_ID_RE = /^\s+controlId:\s+(.+)$/

/**
 * Parse a minimal subset of YAML: key-value and list-of-objects.
 * Only handles the compliance.yaml format — not a general-purpose YAML parser.
 *
 * Format supported:
 *   NODE_ID:
 *     - standard: VALUE
 *       controlId: VALUE
 */
function parseComplianceYaml(raw: string): Record<string, ComplianceMapping[]> {
  const result: Record<string, ComplianceMapping[]> = {}

  const lines = raw.split('\n')
  let currentNodeId: string | null = null
  let currentItem: Partial<ComplianceMapping> | null = null

  const flushItem = (): void => {
    if (currentNodeId === null || currentItem === null) return
    if (currentItem.standard === undefined || currentItem.controlId === undefined) return
    const existing = result[currentNodeId]
    if (existing !== undefined) {
      existing.push({ standard: currentItem.standard, controlId: currentItem.controlId })
    }
    currentItem = null
  }

  for (const line of lines) {
    // Skip empty lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) continue

    // Top-level key: "NODE_ID:" (no leading spaces)
    const topKeyMatch = line.match(TOP_KEY_RE)
    if (topKeyMatch !== null) {
      flushItem()
      currentNodeId = topKeyMatch[1] ?? null
      if (currentNodeId !== null && result[currentNodeId] === undefined) {
        result[currentNodeId] = []
      }
      continue
    }

    if (currentNodeId === null) continue

    // List item start: "  - standard: VALUE"
    const listItemMatch = line.match(LIST_ITEM_RE)
    if (listItemMatch !== null) {
      flushItem()
      currentItem = { standard: (listItemMatch[1] ?? '').trim() }
      continue
    }

    // controlId field: "    controlId: VALUE"
    const controlIdMatch = line.match(CONTROL_ID_RE)
    if (controlIdMatch !== null && currentItem !== null) {
      currentItem.controlId = (controlIdMatch[1] ?? '').trim()
      continue
    }
  }

  // Save last pending item
  flushItem()

  return result
}

/**
 * Load compliance mappings for a node from `.arbiter/compliance.yaml`.
 * Returns undefined when the file does not exist or the node has no mappings.
 */
export function loadComplianceMappings(
  dir: string,
  nodeId: string,
): ComplianceMapping[] | undefined {
  const path = join(dir, COMPLIANCE_RELATIVE_PATH)
  if (!existsSync(path)) return undefined

  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = parseComplianceYaml(raw)
    const mappings = parsed[nodeId]
    if (mappings === undefined || mappings.length === 0) return undefined
    return mappings
  } catch {
    return undefined
  }
}
