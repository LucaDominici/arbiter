import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { INVARIANT_CATALOG } from '../invariants/catalog.js'
import { buildInvNodes } from '../graph/builders/inv.js'
import type { GraphSnapshot } from '../graph/model.js'
import { GraphStore, storeFromSnapshot } from '../graph/store.js'

/**
 * Commands backing `arbiter graph build` and `arbiter verify graph` (#259).
 *
 * Wave-1 wires only the INV builder. The build command writes a stable,
 * pretty-printed `.arbiter/graph.json`; verify graph re-loads it and checks
 * the orphan-invariant failure class.
 */

export interface GraphBuildOptions {
  dir?: string
  /** Override output path (default: `<dir>/.arbiter/graph.json`). */
  output?: string
  json?: boolean
}

export interface GraphBuildResult {
  status: 'ok' | 'error'
  exitCode: 0 | 2
  path: string
  nodes: number
  edges: number
  reason?: string
}

export const GRAPH_RELATIVE_PATH = join('.arbiter', 'graph.json')

export function runGraphBuild(opts: GraphBuildOptions = {}): GraphBuildResult {
  const dir = resolve(opts.dir ?? '.')
  const outPath = opts.output !== undefined ? resolve(opts.output) : join(dir, GRAPH_RELATIVE_PATH)

  const store = new GraphStore()
  buildInvNodes(INVARIANT_CATALOG, store)
  const snapshot = store.snapshot()

  try {
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8')
  } catch (err) {
    return {
      status: 'error',
      exitCode: 2,
      path: outPath,
      nodes: snapshot.nodes.length,
      edges: snapshot.edges.length,
      reason: `failed to write ${outPath}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  return {
    status: 'ok',
    exitCode: 0,
    path: outPath,
    nodes: snapshot.nodes.length,
    edges: snapshot.edges.length,
  }
}

export interface VerifyGraphOptions {
  dir?: string
  /** Override input path (default: `<dir>/.arbiter/graph.json`). */
  input?: string
  json?: boolean
}

export interface OrphanInvariant {
  id: string
  reason: string
}

export interface VerifyGraphResult {
  status: 'ok' | 'error'
  exitCode: 0 | 2
  path: string
  orphans: OrphanInvariant[]
  totalInv: number
  reason?: string
}

/**
 * Verify that every INV node in the graph has at least one outgoing
 * `enforces` edge OR at least one incoming `implements` edge.
 *
 * Wave-1 only ships the INV builder, so `implements` edges won't appear
 * yet — but checking incoming `implements` here makes verify forward-
 * compatible with the FILE/SYMBOL builders that come in #259-followup.
 */
export function runVerifyGraph(opts: VerifyGraphOptions = {}): VerifyGraphResult {
  const dir = resolve(opts.dir ?? '.')
  const inPath = opts.input !== undefined ? resolve(opts.input) : join(dir, GRAPH_RELATIVE_PATH)

  if (!existsSync(inPath)) {
    return {
      status: 'error',
      exitCode: 2,
      path: inPath,
      orphans: [],
      totalInv: 0,
      reason: `graph snapshot not found at ${inPath} — run \`arbiter graph build\` first`,
    }
  }

  let snapshot: GraphSnapshot
  try {
    const raw = readFileSync(inPath, 'utf-8')
    snapshot = parseSnapshot(raw, inPath)
  } catch (err) {
    return {
      status: 'error',
      exitCode: 2,
      path: inPath,
      orphans: [],
      totalInv: 0,
      reason: `failed to parse ${inPath}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const store = storeFromSnapshot(snapshot)
  const invNodes = store.nodesByKind('INV')
  const orphans: OrphanInvariant[] = []

  for (const inv of invNodes) {
    const hasEnforces = store.outgoing(inv.id, 'enforces').length > 0
    const hasImplements = store.incoming(inv.id, 'implements').length > 0
    if (!hasEnforces && !hasImplements) {
      orphans.push({
        id: inv.id,
        reason: 'no `enforces` edge and no incoming `implements` edge',
      })
    }
  }

  if (orphans.length > 0) {
    return {
      status: 'error',
      exitCode: 2,
      path: inPath,
      orphans,
      totalInv: invNodes.length,
      reason: `${orphans.length} orphan invariant(s): ${orphans.map((o) => o.id).join(', ')}`,
    }
  }

  return {
    status: 'ok',
    exitCode: 0,
    path: inPath,
    orphans: [],
    totalInv: invNodes.length,
  }
}

function parseSnapshot(raw: string, path: string): GraphSnapshot {
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`${path}: expected JSON object`)
  }
  const obj = parsed as Record<string, unknown>
  if (!Array.isArray(obj['nodes']) || !Array.isArray(obj['edges'])) {
    throw new Error(`${path}: missing nodes/edges arrays`)
  }
  // Trust the structure — the file is produced by us and committed only
  // transiently; strict schema validation lives in a separate gate.
  return parsed as GraphSnapshot
}
