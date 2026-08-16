// SPDX-License-Identifier: Apache-2.0
/**
 * Commands backing `arbiter graph build` and `arbiter verify graph` (#259).
 *
 * Wave-1 wires only the INV builder and one verify mode (orphan-invariant).
 * #259-followup (this file) adds:
 *   - 6 more builders wired into runGraphBuild
 *   - 4 new verify failure classes: orphan-node, broken-ref, missing-evidence, stale-prover
 *   - full-graph dot/mermaid format output for `graph build --format dot|mermaid`
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ensureDir, writeFileTranslated } from '../utils/fs.js'
import { INVARIANT_CATALOG } from '../invariants/catalog.js'
import { loadConfig } from '../utils/config.js'
import { buildInvNodes } from '../graph/builders/inv.js'
import { buildAdrNodes } from '../graph/builders/adr.js'
import { buildReqNodes } from '../graph/builders/req.js'
import { buildAstNodes } from '../graph/builders/ast.js'
import { buildTestNodes } from '../graph/builders/test-nodes.js'
import { buildEvidenceNodes } from '../graph/builders/evidence.js'
import { buildCanonNodes } from '../graph/builders/canon.js'
import type { GraphSnapshot } from '../graph/model.js'
import { GraphStore } from '../graph/store.js'
import { toDot, toMermaid, toJson } from '../graph/query.js'

export type GraphFormat = 'json' | 'dot' | 'mermaid'

export interface GraphBuildOptions {
  dir?: string
  /** Override output path (default: `<dir>/.arbiter/graph.json`). */
  output?: string
  json?: boolean
  /** Output format for full graph (default: json). */
  format?: GraphFormat
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
  const format = opts.format ?? 'json'

  // Determine output path (json always writes graph.json; dot/mermaid write alongside)
  const defaultExt = format === 'json' ? 'graph.json' : `graph.${format}`
  const defaultOut = join(dir, '.arbiter', defaultExt)
  const outPath = opts.output !== undefined ? resolve(opts.output) : defaultOut

  const store = new GraphStore()

  // #2035 (TC-2): project-declared invariants (PROJ-NN) join the graph when the
  // project's arbiter.json declares them — an enforcement-less PROJ then
  // surfaces as an orphan in `verify graph`, same as catalog entries. Absent
  // config keeps the catalog-only behavior (e.g. arbiter's own repo gate).
  const stored = loadConfig(dir)
  const invariants =
    stored?.governance?.projectInvariants !== undefined &&
    stored.governance.projectInvariants.length > 0
      ? [...INVARIANT_CATALOG, ...stored.governance.projectInvariants]
      : INVARIANT_CATALOG

  // Wire all builders (failures are non-fatal — each builder degrades gracefully)
  buildInvNodes(invariants, store)
  buildAdrNodes(store, {}, dir)
  buildReqNodes(store, {}, dir)
  buildAstNodes(store, {}, dir)
  buildTestNodes(store, {}, dir)
  buildEvidenceNodes(store, {}, dir)
  buildCanonNodes(store, {}, dir)

  const snapshot = store.snapshot()

  // Render to requested format
  let rendered: string
  if (format === 'dot') {
    rendered = toDot(snapshot) + '\n'
  } else if (format === 'mermaid') {
    rendered = toMermaid(snapshot) + '\n'
  } else {
    rendered = toJson(snapshot) + '\n'
  }

  try {
    ensureDir(dirname(outPath))
    writeFileTranslated(outPath, rendered)
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

// ─── Verify graph ─────────────────────────────────────────────────────────────

export interface VerifyGraphOptions {
  dir?: string
  /** Override input path (default: `<dir>/.arbiter/graph.json`). */
  input?: string
  json?: boolean
}

/** One failure item produced by any verify failure class. */
export interface GraphFailure {
  kind: 'orphan-invariant' | 'orphan-node' | 'broken-ref' | 'missing-evidence' | 'stale-prover'
  id: string
  reason: string
}

/**
 * Extended verify result shape (#259-followup).
 *
 * `failures` is the single authoritative list. `orphans` is preserved for
 * backward compatibility with existing tests (Wave-1 tests pin to `orphans`).
 */
interface OrphanInvariant {
  id: string
  reason: string
}

export interface VerifyGraphResult {
  status: 'ok' | 'error'
  exitCode: 0 | 2
  path: string
  /** Backward-compat: orphan-invariant failures only. */
  orphans: OrphanInvariant[]
  totalInv: number
  /** All failure classes (superset of orphans). */
  failures: GraphFailure[]
  reason?: string
}

/**
 * Verify the graph snapshot against all failure classes:
 *
 *   1. orphan-invariant — INV with no enforces AND no incoming implements
 *   2. orphan-node      — any node (except GATE) with zero edges
 *   3. broken-ref       — edge endpoints that point to non-existent nodes
 *                         (detected before store construction via raw JSON scan)
 *   4. missing-evidence — INV with GATE (enforces) but no EVIDENCE prover
 *   5. stale-prover     — TEST node whose path attr doesn't exist on disk
 */
export function runVerifyGraph(opts: VerifyGraphOptions = {}): VerifyGraphResult {
  const dir = resolve(opts.dir ?? '.')
  const inPath = opts.input !== undefined ? resolve(opts.input) : join(dir, GRAPH_RELATIVE_PATH)

  const loadResult = loadSnapshot(inPath)
  if ('reason' in loadResult) {
    return makeError(inPath, [], 0, [], loadResult.reason)
  }
  const snapshot = loadResult.snapshot

  const brokenRefFailures = checkBrokenRefs(snapshot)
  const store = buildStoreFromSnapshot(snapshot)
  const invNodes = store.nodesByKind('INV')

  const orphanInvFailures = checkOrphanInvariants(invNodes, store)
  const orphanNodeFailures = checkOrphanNodes(store)
  const missingEvidenceFailures = checkMissingEvidence(invNodes, store)
  const staleProverFailures = checkStaleProvers(store, dir)

  const allFailures: GraphFailure[] = [
    ...brokenRefFailures,
    ...orphanInvFailures,
    ...orphanNodeFailures,
    ...missingEvidenceFailures,
    ...staleProverFailures,
  ]

  const orphans: OrphanInvariant[] = orphanInvFailures.map((f) => ({ id: f.id, reason: f.reason }))

  if (allFailures.length > 0) {
    return {
      status: 'error',
      exitCode: 2,
      path: inPath,
      orphans,
      totalInv: invNodes.length,
      failures: allFailures,
      reason: summarizeFailures(allFailures),
    }
  }

  return {
    status: 'ok',
    exitCode: 0,
    path: inPath,
    orphans: [],
    totalInv: invNodes.length,
    failures: [],
  }
}

// ─── Verify helpers ────────────────────────────────────────────────────────────

function loadSnapshot(inPath: string): { snapshot: GraphSnapshot } | { reason: string } {
  if (!existsSync(inPath)) {
    return { reason: `graph snapshot not found at ${inPath} — run \`arbiter graph build\` first` }
  }
  let raw: string
  try {
    raw = readFileSync(inPath, 'utf-8')
  } catch (err) {
    return {
      reason: `failed to read ${inPath}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return {
      reason: `failed to parse ${inPath}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { reason: `${inPath}: expected JSON object` }
  }
  const obj = parsed as Record<string, unknown>
  if (!Array.isArray(obj['nodes']) || !Array.isArray(obj['edges'])) {
    return { reason: `${inPath}: missing nodes/edges arrays` }
  }
  return { snapshot: parsed as GraphSnapshot }
}

function buildStoreFromSnapshot(snapshot: GraphSnapshot): GraphStore {
  const nodeIds = new Set(snapshot.nodes.map((n) => n.id))
  const store = new GraphStore()
  for (const node of snapshot.nodes) store.upsertNode(node)
  for (const edge of snapshot.edges) {
    if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) store.addEdge(edge)
  }
  return store
}

/** broken-ref: scan raw snapshot before store construction (store.addEdge throws on missing endpoints). */
function checkBrokenRefs(snapshot: GraphSnapshot): GraphFailure[] {
  const nodeIds = new Set(snapshot.nodes.map((n) => n.id))
  const failures: GraphFailure[] = []
  for (const edge of snapshot.edges) {
    const edgeId = `${edge.from} -[${edge.kind}]-> ${edge.to}`
    if (!nodeIds.has(edge.from)) {
      failures.push({
        kind: 'broken-ref',
        id: edgeId,
        reason: `edge 'from' node "${edge.from}" does not exist`,
      })
    }
    if (!nodeIds.has(edge.to)) {
      failures.push({
        kind: 'broken-ref',
        id: edgeId,
        reason: `edge 'to' node "${edge.to}" does not exist`,
      })
    }
  }
  return failures
}

/** orphan-invariant: INV with no enforces AND no incoming implements. */
function checkOrphanInvariants(
  invNodes: ReturnType<GraphStore['nodesByKind']>,
  store: GraphStore,
): GraphFailure[] {
  return invNodes
    .filter(
      (inv) =>
        store.outgoing(inv.id, 'enforces').length === 0 &&
        store.incoming(inv.id, 'implements').length === 0,
    )
    .map((inv) => ({
      kind: 'orphan-invariant' as const,
      id: inv.id,
      reason: 'no `enforces` edge and no incoming `implements` edge',
    }))
}

/** orphan-node: any non-GATE node with zero edges. */
function checkOrphanNodes(store: GraphStore): GraphFailure[] {
  return store
    .allNodes()
    .filter(
      (node) =>
        node.kind !== 'GATE' &&
        store.outgoing(node.id).length === 0 &&
        store.incoming(node.id).length === 0,
    )
    .map((node) => ({
      kind: 'orphan-node' as const,
      id: node.id,
      reason: `${node.kind} node has no edges`,
    }))
}

/**
 * missing-evidence: INV enforces GATE that lacks a produces→EVIDENCE edge.
 * Only fires when the graph has evidence infrastructure (≥1 produces edge).
 */
function checkMissingEvidence(
  invNodes: ReturnType<GraphStore['nodesByKind']>,
  store: GraphStore,
): GraphFailure[] {
  const gateEvidenceEdges = store.allEdges().filter((e) => e.kind === 'produces')
  if (gateEvidenceEdges.length === 0) return []
  const gatesWithEvidence = new Set(gateEvidenceEdges.map((e) => e.from))
  const failures: GraphFailure[] = []
  for (const inv of invNodes) {
    for (const edge of store.outgoing(inv.id, 'enforces')) {
      if (!gatesWithEvidence.has(edge.to)) {
        failures.push({
          kind: 'missing-evidence',
          id: inv.id,
          reason: `INV enforces GATE "${edge.to}" but that GATE has no EVIDENCE node via produces edge`,
        })
        break
      }
    }
  }
  return failures
}

/** stale-prover: TEST node whose path attr doesn't exist on disk. */
function checkStaleProvers(store: GraphStore, dir: string): GraphFailure[] {
  const failures: GraphFailure[] = []
  for (const testNode of store.nodesByKind('TEST')) {
    const testPath = testNode.attrs['path']
    if (typeof testPath !== 'string') continue
    let exists = false
    try {
      statSync(join(dir, testPath))
      exists = true
    } catch {
      /* not found */
    }
    if (!exists) {
      failures.push({
        kind: 'stale-prover',
        id: testNode.id,
        reason: `TEST node path "${testPath}" does not exist on disk`,
      })
    }
  }
  return failures
}

function makeError(
  path: string,
  orphans: OrphanInvariant[],
  totalInv: number,
  failures: GraphFailure[],
  reason: string,
): VerifyGraphResult {
  return { status: 'error', exitCode: 2, path, orphans, totalInv, failures, reason }
}

function summarizeFailures(failures: GraphFailure[]): string {
  const byKind: Record<string, string[]> = {}
  for (const f of failures) {
    const bucket = byKind[f.kind] ?? []
    bucket.push(f.id)
    byKind[f.kind] = bucket
  }
  return Object.entries(byKind)
    .map(([k, ids]) => `${ids.length} ${k}(${ids.join(', ')})`)
    .join(', ')
}
