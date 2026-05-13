import { existsSync, readFileSync } from 'node:fs'
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
    if (parsed === null || typeof parsed !== 'object') {
      throw new Error('expected JSON object')
    }
    const obj = parsed as Record<string, unknown>
    if (!Array.isArray(obj['nodes']) || !Array.isArray(obj['edges'])) {
      throw new Error('missing nodes/edges arrays')
    }
    return { ok: true, snapshot: parsed as GraphSnapshot }
  } catch (err) {
    return {
      ok: false,
      reason: `failed to parse ${inPath}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
