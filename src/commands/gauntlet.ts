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

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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

  // FS read is part of the structured contract (#1648): a directory, EACCES, or
  // any other read error must surface as `{status:'error',exitCode:2}`, not a
  // thrown crash that the CLI global catch reports as exit 1.
  let rawSpec: string
  try {
    rawSpec = readFileSync(specPath, 'utf-8')
  } catch (err) {
    return generateFsError(err)
  }

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

  // The whole FS write body is guarded (#1648): mkdir/write of the artifact and
  // the hash manifest each return the structured exit-2 envelope on ENOTDIR /
  // EISDIR / EACCES / ENOSPC rather than escaping the contract.
  const files: string[] = []
  let outFile: string
  try {
    mkdirSync(outDir, { recursive: true })

    const content = generateContent(stack, spec, rows)
    const ext = stackExtension(stack)
    // The spec author controls `spec.name`, and the emitters already sanitize it
    // per-sink for source identifiers (#1590). The OUTPUT FILENAME is a sink too:
    // a raw `/` or `..` would write OUTSIDE outDir (path traversal / arbitrary
    // write, #1620). Sanitize to a filesystem-safe stem so the artifact is always
    // confined to outDir — matching the codebase's accept-and-sanitize stance
    // rather than rejecting otherwise-valid names (`#260`, `bug#hot`).
    outFile = join(outDir, `${safeFileStem(spec.name)}-gauntlet.${ext}`)
    writeFileSync(outFile, content, 'utf-8')
    files.push(outFile)

    // Write a manifest hash (#1572): the spec hash PLUS a sha256 of every emitted
    // file. This lets `verify` detect a deleted or hand-edited artifact, not just
    // a mutated spec. MERGE into a same-spec manifest instead of overwriting it
    // wholesale (#1644): a polyglot suite emits one artifact per stack into a
    // shared outDir, and each must stay tracked — otherwise only the last-generated
    // file is tamper-evident.
    const newSpecHash = specHash(rawSpec)
    const manifest: GauntletHashManifest = {
      spec: newSpecHash,
      files: { ...priorTrackedFiles(outDir, newSpecHash), [basename(outFile)]: sha256(content) },
    }
    writeFileSync(join(outDir, HASH_FILE), JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
  } catch (err) {
    return generateFsError(err)
  }

  // Graph integration — best-effort (#1648): a graph read/write failure degrades
  // to zero edges (mirroring the loadGraphSnapshot fail-soft) rather than failing
  // an otherwise-successful generate.
  let graphEdges = 0
  const dir = opts.dir !== undefined ? resolve(opts.dir) : dirname(specPath)
  const graphPath = join(dir, GRAPH_RELATIVE_PATH)
  if (existsSync(graphPath)) {
    try {
      graphEdges = integrateGraph(graphPath, spec.name, specPath, rows.length)
    } catch {
      graphEdges = 0
    }
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

  // Symmetric to the deleted/modified checks (#1644): an artifact present on disk
  // but absent from the manifest is untracked — a stale leftover or a hand-dropped
  // test that the hash gate would otherwise wave through. Fail closed on it.
  for (const entry of readdirSync(outDir)) {
    if (isGauntletArtifact(entry) && !Object.hasOwn(manifest.files, entry)) {
      return {
        status: 'error',
        exitCode: 2,
        reason: `untracked generated artifact "${entry}" found in ${outDir} (not in the hash manifest) — ${REGEN_HINT}`,
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
 * Coerce a spec name into a filesystem-safe filename stem (#1620). Every char
 * outside `[A-Za-z0-9._-]` — including the `/` and `\` path separators that drive
 * traversal — is mapped to `_`, so the emitted `${stem}-gauntlet.${ext}` can never
 * resolve outside outDir. Leading dots are stripped so a name like `..` cannot
 * yield a dotfile/relative-looking stem; an empty result falls back to `gauntlet`.
 */
function safeFileStem(name: string): string {
  const stem = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '')
  return stem === '' ? 'gauntlet' : stem
}

/** True for a generated gauntlet artifact (`<stem>-gauntlet.<ext>`); excludes the
 *  `.gauntlet-hash` manifest sidecar, which has no `-gauntlet.` segment. */
function isGauntletArtifact(filename: string): boolean {
  return /-gauntlet\.[^.]/.test(filename)
}

/**
 * Read the artifact map already tracked in `outDir`'s `.gauntlet-hash`, but only
 * when its spec hash still matches the spec being generated (#1644). A same-spec
 * manifest is merged so a multi-stack suite keeps every prior stack tracked; a
 * stale (different-spec) or unreadable manifest contributes nothing, so the new
 * generation starts fresh — prior artifacts are stale by definition.
 */
function priorTrackedFiles(outDir: string, currentSpecHash: string): Record<string, string> {
  const hashPath = join(outDir, HASH_FILE)
  if (!existsSync(hashPath)) return {}
  const prior = parseHashManifest(readFileSync(hashPath, 'utf-8'))
  if (prior === null || prior.spec !== currentSpecHash) return {}
  return prior.files
}

/** Structured exit-2 envelope for an FS failure inside generate (#1648). */
function generateFsError(err: unknown): GauntletGenerateResult {
  return {
    status: 'error',
    exitCode: 2,
    files: [],
    rows: 0,
    graphEdges: 0,
    reason: err instanceof Error ? err.message : String(err),
  }
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
