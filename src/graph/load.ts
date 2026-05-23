// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs'
import { ALL_NODE_KINDS, ALL_EDGE_KINDS } from './model.js'
import type { GraphSnapshot } from './model.js'

/**
 * Shared graph-snapshot loader (#264, #265).
 *
 * Extracted from `commands/trace.ts` to avoid a third copy of the same
 * parse-snapshot pattern (it already exists in trace.ts and graph.ts).
 * Any command that needs to re-hydrate a snapshot from disk should use this.
 */

export type LoadSnapshotOutcome =
  | { ok: true; snapshot: GraphSnapshot }
  | { ok: false; reason: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isValidGraphNode(v: unknown): boolean {
  if (!isRecord(v)) return false
  if (typeof v['id'] !== 'string' || v['id'].length === 0) return false
  if (typeof v['kind'] !== 'string') return false
  if (!(ALL_NODE_KINDS as readonly string[]).includes(v['kind'])) return false
  if (!isRecord(v['attrs'])) return false
  return true
}

function isValidGraphEdge(v: unknown): boolean {
  if (!isRecord(v)) return false
  if (typeof v['from'] !== 'string' || v['from'].length === 0) return false
  if (typeof v['to'] !== 'string' || v['to'].length === 0) return false
  if (typeof v['kind'] !== 'string') return false
  if (!(ALL_EDGE_KINDS as readonly string[]).includes(v['kind'])) return false
  if (!isRecord(v['attrs'])) return false
  return true
}

/** Type guard — validates a parsed JSON value as a well-formed GraphSnapshot. */
function isValidGraphSnapshot(data: unknown): data is GraphSnapshot {
  if (!isRecord(data)) return false
  if (!Array.isArray(data['nodes'])) return false
  if (!Array.isArray(data['edges'])) return false
  for (const node of data['nodes']) {
    if (!isValidGraphNode(node)) return false
  }
  for (const edge of data['edges']) {
    if (!isValidGraphEdge(edge)) return false
  }
  return true
}

export function loadGraphSnapshot(inPath: string): LoadSnapshotOutcome {
  if (!existsSync(inPath)) {
    return {
      ok: false,
      reason: `graph snapshot not found at ${inPath} — run \`arbiter graph build\` first`,
    }
  }
  try {
    const raw = readFileSync(inPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!isValidGraphSnapshot(parsed)) {
      return {
        ok: false,
        reason: `graph.json failed schema validation — expected { nodes: GraphNode[], edges: GraphEdge[] }`,
      }
    }
    return { ok: true, snapshot: parsed }
  } catch (err) {
    return {
      ok: false,
      reason: `failed to parse ${inPath}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
