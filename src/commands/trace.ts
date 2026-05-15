// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { GraphSnapshot } from '../graph/model.js'
import { trace, toDot, toJson, toMermaid } from '../graph/query.js'
import { storeFromSnapshot } from '../graph/store.js'
import { GRAPH_RELATIVE_PATH } from './graph.js'

/**
 * `arbiter trace --from <NODE_ID> [--depth N] [--format json|dot|mermaid]`
 *
 * Reads the persisted graph snapshot from `.arbiter/graph.json` and renders
 * a subgraph centred on the requested node. All three formats are pure
 * functions over the same `GraphSnapshot` so they can never disagree on
 * which nodes the trace contains.
 */

export type TraceFormat = 'json' | 'dot' | 'mermaid'

export interface TraceOptions {
  from: string
  depth?: number
  format?: TraceFormat
  dir?: string
  /** Override input path (default: `<dir>/.arbiter/graph.json`). */
  input?: string
}

export interface TraceResult {
  status: 'ok' | 'error'
  exitCode: 0 | 2
  format: TraceFormat
  output: string
  reason?: string
}

const ALLOWED_FORMATS: readonly TraceFormat[] = ['json', 'dot', 'mermaid']

type LoadOutcome = { ok: true; snapshot: GraphSnapshot } | { ok: false; reason: string }

function loadSnapshot(inPath: string): LoadOutcome {
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

function render(format: TraceFormat, snapshot: GraphSnapshot): string {
  if (format === 'dot') return toDot(snapshot)
  if (format === 'mermaid') return toMermaid(snapshot)
  return toJson(snapshot)
}

export function runTrace(opts: TraceOptions): TraceResult {
  const format = opts.format ?? 'json'
  if (!ALLOWED_FORMATS.includes(format)) {
    return {
      status: 'error',
      exitCode: 2,
      format: 'json',
      output: '',
      reason: `unknown format "${format}" — expected one of ${ALLOWED_FORMATS.join(', ')}`,
    }
  }

  const dir = resolve(opts.dir ?? '.')
  const inPath = opts.input !== undefined ? resolve(opts.input) : join(dir, GRAPH_RELATIVE_PATH)

  const loaded = loadSnapshot(inPath)
  if (!loaded.ok) {
    return { status: 'error', exitCode: 2, format, output: '', reason: loaded.reason }
  }

  const store = storeFromSnapshot(loaded.snapshot)
  if (!store.hasNode(opts.from)) {
    return {
      status: 'error',
      exitCode: 2,
      format,
      output: '',
      reason: `unknown node id "${opts.from}" in graph snapshot at ${inPath}`,
    }
  }

  const sub = trace(store, opts.from, opts.depth !== undefined ? { depth: opts.depth } : {})
  return { status: 'ok', exitCode: 0, format, output: render(format, sub) }
}
