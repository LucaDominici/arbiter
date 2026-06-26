// SPDX-License-Identifier: Apache-2.0
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
import { basename, dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parseSpec, specHash } from '../gauntlet/spec.js'
import { ipog } from '../gauntlet/ipog.js'
import { emitTypeScript } from '../gauntlet/emitters/typescript.js'
import { emitJava } from '../gauntlet/emitters/java.js'
import { emitRust } from '../gauntlet/emitters/rust.js'
import { storeFromSnapshot } from '../graph/store.js'
import { loadGraphSnapshot } from '../graph/load.js'
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

  // Write a manifest hash (#1572): the spec hash PLUS a sha256 of every emitted
  // file. This lets `verify` detect a deleted or hand-edited artifact, not just
  // a mutated spec.
  const manifest: GauntletHashManifest = {
    spec: specHash(rawSpec),
    files: { [basename(outFile)]: sha256(content) },
  }
  writeFileSync(join(outDir, HASH_FILE), JSON.stringify(manifest, null, 2) + '\n', 'utf-8')

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
}

export interface GauntletVerifyResult {
  status: 'ok' | 'error'
  exitCode: 0 | 2
  reason?: string
}

/** Manifest persisted to `.gauntlet-hash`: spec hash + per-file content hash (#1572). */
interface GauntletHashManifest {
  spec: string
  files: Record<string, string>
}

const REGEN_HINT = 're-run `arbiter gauntlet generate`'

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

  const manifest = parseHashManifest(readFileSync(hashFile, 'utf-8'))
  if (manifest === null) {
    return {
      status: 'error',
      exitCode: 2,
      reason: `generated tests are out of sync with spec (unreadable hash manifest) — ${REGEN_HINT}`,
    }
  }

  const currentHash = specHash(readFileSync(specPath, 'utf-8'))
  if (currentHash !== manifest.spec) {
    return {
      status: 'error',
      exitCode: 2,
      reason: `generated tests are out of sync with spec — ${REGEN_HINT}`,
    }
  }

  // The artifact the gate is supposed to protect must still exist AND match the
  // bytes the generator emitted — a deleted or hand-edited test must fail (#1572).
  for (const [name, expected] of Object.entries(manifest.files)) {
    const filePath = join(outDir, name)
    if (!existsSync(filePath)) {
      return {
        status: 'error',
        exitCode: 2,
        reason: `generated test "${name}" is missing (deleted since generation) — ${REGEN_HINT}`,
      }
    }
    if (sha256(readFileSync(filePath, 'utf-8')) !== expected) {
      return {
        status: 'error',
        exitCode: 2,
        reason: `generated test "${name}" was modified since generation (content drift) — ${REGEN_HINT}`,
      }
    }
  }

  return { status: 'ok', exitCode: 0 }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** SHA-256 of raw content (exact bytes — no normalisation, so any edit is caught). */
function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

/**
 * Parse and shape-validate the `.gauntlet-hash` manifest. Returns `null` for any
 * legacy plain-hash sidecar or corrupt content so the caller can treat it as
 * out-of-sync rather than trusting it (#1572).
 */
function parseHashManifest(raw: string): GauntletHashManifest | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>
  if (typeof obj['spec'] !== 'string') return null
  if (typeof obj['files'] !== 'object' || obj['files'] === null) return null
  const files: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj['files'] as Record<string, unknown>)) {
    if (typeof v !== 'string') return null
    files[k] = v
  }
  return { spec: obj['spec'], files }
}

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
  // Route through the SSOT loader (#1593): a malformed graph.json must degrade
  // to zero edges (the prior catch intent), not crash the gauntlet run with an
  // uncaught `snapshot.nodes is not iterable`.
  const outcome = loadGraphSnapshot(graphPath)
  if (!outcome.ok) {
    return 0
  }

  const store = storeFromSnapshot(outcome.snapshot)
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
