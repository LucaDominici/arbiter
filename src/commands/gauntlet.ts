/**
 * `arbiter gauntlet` commands (#260).
 *
 * Subcommands:
 *   generate  — Read YAML spec, run IPOG, write test files per stack
 *   verify    — Check that generated tests are in sync with spec hash
 *
 * Graph integration: when `.arbiter/graph.json` exists in `dir`, the command
 * appends GAUNTLET_SPEC → TESTS edges using existing node kinds:
 *   - The spec is modelled as a SYMBOL node (subkind: "gauntlet-spec")
 *   - Each generated test is a TEST node
 *   - Edges use `proves` (SYMBOL → TEST would be non-standard; we use
 *     TEST → SYMBOL with `proves` reversed: SYMBOL implements INV/REQ,
 *     EVIDENCE produces proof). Instead we model it as:
 *       FILE:<spec> implements REQ:<spec-name> (notional)
 *     which is the closed-set compatible encoding.
 *
 * CANON-16 Existing Code Survey:
 *   - Grepped src/generators/ for "pairwise", "combinatorial", "gauntlet": nothing found.
 *   - Grepped src/commands/ for similar generate+verify pattern: none.
 *   - New file justified.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseSpec, specHash } from '../gauntlet/spec.js'
import { ipog } from '../gauntlet/ipog.js'
import { emitTypeScript } from '../gauntlet/emitters/typescript.js'
import { emitJava } from '../gauntlet/emitters/java.js'
import { emitRust } from '../gauntlet/emitters/rust.js'
import { storeFromSnapshot } from '../graph/store.js'
import type { GraphSnapshot } from '../graph/model.js'
import { GRAPH_RELATIVE_PATH } from './graph.js'

export type GauntletStack = 'typescript' | 'java' | 'rust'

export interface GauntletGenerateOptions {
  /** Path to the gauntlet.yaml spec file. */
  spec: string
  /** Directory to write generated test files. */
  out: string
  /** Target stack. Defaults to 'typescript'. */
  stack?: GauntletStack
  /** Project root (used to locate .arbiter/graph.json). */
  dir?: string
}

export interface GauntletGenerateResult {
  status: 'ok' | 'error'
  exitCode: 0 | 2
  files: string[]
  rows: number
  graphEdges: number
  reason?: string
}

const HASH_FILE = '.gauntlet-hash'

export function runGauntletGenerate(opts: GauntletGenerateOptions): GauntletGenerateResult {
  const specPath = resolve(opts.spec)
  const outDir = resolve(opts.out)
  const stack: GauntletStack = opts.stack ?? 'typescript'

  if (!existsSync(specPath)) {
    return {
      status: 'error',
      exitCode: 2,
      files: [],
      rows: 0,
      graphEdges: 0,
      reason: `spec not found at ${specPath}`,
    }
  }

  const rawSpec = readFileSync(specPath, 'utf-8')
  const parseResult = parseSpec(rawSpec)
  if (!parseResult.ok) {
    return {
      status: 'error',
      exitCode: 2,
      files: [],
      rows: 0,
      graphEdges: 0,
      reason: parseResult.reason,
    }
  }

  const { spec } = parseResult
  const strength = spec.strategy === '3-way' ? 3 : 2
  const rows = ipog({ dimensions: spec.dimensions, strength, constraints: spec.constraints })

  mkdirSync(outDir, { recursive: true })

  const files: string[] = []
  const content = generateContent(stack, spec, rows)
  const ext = stackExtension(stack)
  const outFile = join(outDir, `${spec.name}-gauntlet.${ext}`)
  writeFileSync(outFile, content, 'utf-8')
  files.push(outFile)

  // Write hash file for sync gate
  const hash = specHash(rawSpec)
  writeFileSync(join(outDir, HASH_FILE), hash, 'utf-8')

  // Graph integration
  let graphEdges = 0
  const dir = opts.dir !== undefined ? resolve(opts.dir) : dirname(specPath)
  const graphPath = join(dir, GRAPH_RELATIVE_PATH)
  if (existsSync(graphPath)) {
    graphEdges = integrateGraph(graphPath, spec.name, specPath, rows.length)
  }

  return { status: 'ok', exitCode: 0, files, rows: rows.length, graphEdges }
}

export interface GauntletVerifyOptions {
  spec: string
  out: string
  coverage: 'pairwise' | '3-way'
}

export interface GauntletVerifyResult {
  status: 'ok' | 'error'
  exitCode: 0 | 2
  reason?: string
}

export function runGauntletVerify(opts: GauntletVerifyOptions): GauntletVerifyResult {
  const specPath = resolve(opts.spec)
  const outDir = resolve(opts.out)
  const hashFile = join(outDir, HASH_FILE)

  if (!existsSync(outDir) || !existsSync(hashFile)) {
    return {
      status: 'error',
      exitCode: 2,
      reason: `no generated files found at ${outDir} — run \`arbiter gauntlet generate\` first`,
    }
  }

  if (!existsSync(specPath)) {
    return { status: 'error', exitCode: 2, reason: `spec not found at ${specPath}` }
  }

  const rawSpec = readFileSync(specPath, 'utf-8')
  const currentHash = specHash(rawSpec)
  const storedHash = readFileSync(hashFile, 'utf-8').trim()

  if (currentHash !== storedHash) {
    return {
      status: 'error',
      exitCode: 2,
      reason: `generated tests are out of sync with spec — re-run \`arbiter gauntlet generate\``,
    }
  }

  return { status: 'ok', exitCode: 0 }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function generateContent(
  stack: GauntletStack,
  spec: import('../gauntlet/spec.js').GauntletSpec,
  rows: import('../gauntlet/ipog.js').IpogRow[],
): string {
  if (stack === 'java') return emitJava(spec, rows)
  if (stack === 'rust') return emitRust(spec, rows)
  return emitTypeScript(spec, rows)
}

function stackExtension(stack: GauntletStack): string {
  if (stack === 'java') return 'java'
  if (stack === 'rust') return 'rs'
  return 'spec.ts'
}

/**
 * Integrate gauntlet artefacts into the provenance graph.
 * Uses existing closed-set NodeKind/EdgeKind; models the spec as a SYMBOL
 * node (subkind gauntlet-spec) and tests as TEST nodes.
 * Returns the number of new edges added.
 */
function integrateGraph(
  graphPath: string,
  specName: string,
  specFilePath: string,
  rowCount: number,
): number {
  let snapshot: GraphSnapshot
  try {
    snapshot = JSON.parse(readFileSync(graphPath, 'utf-8')) as GraphSnapshot
  } catch {
    return 0
  }

  const store = storeFromSnapshot(snapshot)
  let edgesAdded = 0

  const specNodeId = `SYMBOL:gauntlet-spec:${specName}`
  if (!store.hasNode(specNodeId)) {
    store.upsertNode({
      id: specNodeId,
      kind: 'SYMBOL',
      attrs: { subkind: 'gauntlet-spec', specFile: specFilePath, title: specName },
    })
  }

  // Add TEST nodes for each row (representative)
  const testNodeId = `TEST:gauntlet:${specName}`
  if (!store.hasNode(testNodeId)) {
    store.upsertNode({
      id: testNodeId,
      kind: 'TEST',
      attrs: { title: `gauntlet:${specName}`, rows: rowCount },
    })
  }

  // SYMBOL proves TEST (the spec defines the test suite)
  try {
    store.addEdge({
      from: testNodeId,
      to: specNodeId,
      kind: 'proves',
      attrs: { source: 'gauntlet' },
    })
    edgesAdded++
  } catch {
    // already exists — idempotent
  }

  const updatedSnapshot = store.snapshot()
  writeFileSync(graphPath, JSON.stringify(updatedSnapshot, null, 2) + '\n', 'utf-8')
  return edgesAdded
}
