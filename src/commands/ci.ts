/**
 * `arbiter ci plan` / `arbiter ci verify-plan` commands (#261).
 *
 * ci plan:
 *   1. Accept a list of changed files (from git diff --name-only)
 *   2. Load .arbiter/graph.json if present
 *   3. Traverse graph: FILE → implements → INV → enforces → GATE
 *   4. Compute risk class (from src/risk/classifier.ts patterns)
 *   5. Emit a CiPlan JSON document
 *
 * ci verify-plan:
 *   Accept a CiPlan + a CI result object, check all required gates ran.
 *
 * Fallback behaviour (no graph): emit a minimal plan with risk_class=R-unknown
 * and fallback=true. This satisfies AC-4 (graceful fallback).
 *
 * CANON-16 Existing Code Survey:
 *   - Grepped src/risk/ for risk class enums: found RiskLevel in classifier.ts (R0–R4).
 *   - Grepped src/commands/ for "ci plan", "affected", "impacted": nothing found.
 *   - New file justified.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { storeFromSnapshot } from '../graph/store.js'
import type { GraphSnapshot } from '../graph/model.js'
import { GRAPH_RELATIVE_PATH } from './graph.js'
import type { GraphStore } from '../graph/store.js'

export interface CiPlan {
  risk_class: string
  impacted_invs: string[]
  required_gates: string[]
  fallback: boolean
  warning?: string
}

export interface CiPlanOptions {
  dir?: string
  /** Git ref (informational — we accept changedFiles directly for testability). */
  diff?: string
  /** List of changed file paths (repo-relative). */
  changedFiles?: string[]
  /** Output format: 'json' (default) or 'mermaid'. */
  format?: 'json' | 'mermaid'
}

export interface CiPlanResult {
  status: 'ok' | 'error'
  exitCode: 0 | 2
  plan: CiPlan
  mermaid?: string
  reason?: string
}

export interface CiVerifyPlanOptions {
  plan: CiPlan
  ciResult: { gates: string[] }
}

export interface CiVerifyPlanResult {
  status: 'ok' | 'error'
  exitCode: 0 | 2
  missingGates: string[]
  reason?: string
}

export function runCiPlan(opts: CiPlanOptions): CiPlanResult {
  const dir = resolve(opts.dir ?? '.')
  const graphPath = join(dir, GRAPH_RELATIVE_PATH)
  const changedFiles = opts.changedFiles ?? []
  const format = opts.format ?? 'json'

  // Fallback when no graph exists
  if (!existsSync(graphPath)) {
    const plan: CiPlan = {
      risk_class: 'R-unknown',
      impacted_invs: [],
      required_gates: [],
      fallback: true,
      warning: 'no graph snapshot found — run `arbiter graph build` for full analysis',
    }
    const mermaid = format === 'mermaid' ? buildFallbackMermaid() : undefined
    return { status: 'ok', exitCode: 0, plan, ...(mermaid !== undefined ? { mermaid } : {}) }
  }

  let snapshot: GraphSnapshot
  try {
    snapshot = JSON.parse(readFileSync(graphPath, 'utf-8')) as GraphSnapshot
  } catch (err) {
    return {
      status: 'error',
      exitCode: 2,
      plan: { risk_class: 'R-unknown', impacted_invs: [], required_gates: [], fallback: true },
      reason: `failed to parse graph: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const store = storeFromSnapshot(snapshot)
  const { impactedInvs, requiredGates } = traverseImpact(store, changedFiles)
  const riskClass = computeRiskClass(changedFiles)

  const plan: CiPlan = {
    risk_class: riskClass,
    impacted_invs: [...impactedInvs].sort(),
    required_gates: [...requiredGates].sort(),
    fallback: false,
  }

  let mermaid: string | undefined
  if (format === 'mermaid') {
    mermaid = buildImpactMermaid(changedFiles, [...impactedInvs], [...requiredGates])
  }

  return { status: 'ok', exitCode: 0, plan, ...(mermaid !== undefined ? { mermaid } : {}) }
}

export function runCiVerifyPlan(opts: CiVerifyPlanOptions): CiVerifyPlanResult {
  const { plan, ciResult } = opts

  // Fallback plans always pass — nothing to verify
  if (plan.fallback) {
    return { status: 'ok', exitCode: 0, missingGates: [] }
  }

  const gateSet = new Set(ciResult.gates)
  const missing = plan.required_gates.filter((g) => !gateSet.has(g))

  if (missing.length > 0) {
    return {
      status: 'error',
      exitCode: 2,
      missingGates: missing,
      reason: `${missing.length} required gate(s) did not run: ${missing.join(', ')}`,
    }
  }

  return { status: 'ok', exitCode: 0, missingGates: [] }
}

// ── internals ────────────────────────────────────────────────────────────────

/**
 * Traverse the provenance graph from changed FILE nodes.
 *
 * Walk pattern: FILE --implements--> INV --enforces--> GATE
 *
 * We also traverse in reverse: for each changed file, if there's a FILE
 * node matching it, find all INV nodes reachable via `implements` edges
 * (in either direction), then find GATE nodes via `enforces` edges.
 */
function traverseImpact(
  store: GraphStore,
  changedFiles: string[],
): { impactedInvs: Set<string>; requiredGates: Set<string> } {
  const impactedInvs = new Set<string>()
  const requiredGates = new Set<string>()

  for (const file of changedFiles) {
    // Try exact match first, then prefix match
    const fileNodeId = `FILE:${file}`
    const fileNode = store.getNode(fileNodeId)
    if (fileNode === undefined) {
      // No exact node — try to find FILE nodes whose path matches
      for (const node of store.nodesByKind('FILE')) {
        const nodePath =
          typeof node.attrs['path'] === 'string'
            ? node.attrs['path']
            : node.id.replace(/^FILE:/, '')
        if (nodePath === file || node.id === fileNodeId) {
          collectFromFile(store, node.id, impactedInvs, requiredGates)
        }
      }
    } else {
      collectFromFile(store, fileNodeId, impactedInvs, requiredGates)
    }
  }

  // Also include any INV touched directly (e.g. catalog.ts changed → all INVs)
  const catalogFiles = ['src/invariants/catalog.ts', 'AGENTS.md']
  const touchesCatalog = changedFiles.some((f) => catalogFiles.includes(f))
  if (touchesCatalog) {
    for (const inv of store.nodesByKind('INV')) {
      impactedInvs.add(inv.id)
      for (const edge of store.outgoing(inv.id, 'enforces')) {
        requiredGates.add(edge.to.replace(/^GATE:/, ''))
      }
    }
  }

  return { impactedInvs, requiredGates }
}

function collectFromFile(
  store: GraphStore,
  fileNodeId: string,
  impactedInvs: Set<string>,
  requiredGates: Set<string>,
): void {
  // FILE --implements--> INV
  for (const edge of store.outgoing(fileNodeId, 'implements')) {
    const target = store.getNode(edge.to)
    if (target?.kind === 'INV') {
      impactedInvs.add(target.id)
      // INV --enforces--> GATE
      for (const gateEdge of store.outgoing(target.id, 'enforces')) {
        requiredGates.add(gateEdge.to.replace(/^GATE:/, ''))
      }
    }
  }
  // Reverse: INV --implements (incoming)--> FILE
  for (const edge of store.incoming(fileNodeId, 'implements')) {
    const source = store.getNode(edge.from)
    if (source?.kind === 'INV') {
      impactedInvs.add(source.id)
    }
  }
}

/**
 * Compute risk class from changed file paths.
 * Uses the same pattern-based approach as src/risk/classifier.ts.
 * Returns the highest-risk class seen, or 'R-unknown' if unclassifiable.
 */
function computeRiskClass(changedFiles: string[]): string {
  const RISK_PATTERNS: Array<{ pattern: RegExp; level: string }> = [
    { pattern: /(^|\/)migrations?\//i, level: 'R0' },
    { pattern: /\.sql$/i, level: 'R0' },
    { pattern: /(^|\/)auth\//i, level: 'R1' },
    { pattern: /(^|\/)payment(s)?\//i, level: 'R1' },
    { pattern: /(^|\/)api\//i, level: 'R2' },
    { pattern: /(^|\/)server\//i, level: 'R2' },
    { pattern: /\.(ts|js|py|rs|java|go)$/i, level: 'R2' },
    { pattern: /(^|\/)components?\//i, level: 'R3' },
    { pattern: /\.(md|yml|yaml|json)$/i, level: 'R4' },
  ]
  const ORDER = ['R0', 'R1', 'R2', 'R3', 'R4']

  let best: string | null = null
  for (const file of changedFiles) {
    const norm = file.replace(/\\/g, '/')
    for (const rule of RISK_PATTERNS) {
      if (rule.pattern.test(norm)) {
        if (best === null || ORDER.indexOf(rule.level) < ORDER.indexOf(best)) {
          best = rule.level
        }
        break
      }
    }
  }
  return best ?? 'R-unknown'
}

function buildFallbackMermaid(): string {
  return 'graph LR\n  WARN["No graph — run arbiter graph build"]\n'
}

function buildImpactMermaid(changedFiles: string[], invs: string[], gates: string[]): string {
  const lines: string[] = ['graph LR']
  for (const f of changedFiles) {
    const safeId = f.replace(/[^A-Za-z0-9_]/g, '_')
    lines.push(`  ${safeId}["FILE: ${f}"]`)
  }
  for (const inv of invs) {
    const safeId = inv.replace(/[^A-Za-z0-9_]/g, '_')
    lines.push(`  ${safeId}["${inv}"]`)
    for (const f of changedFiles) {
      const fSafe = f.replace(/[^A-Za-z0-9_]/g, '_')
      lines.push(`  ${fSafe} -->|implements| ${safeId}`)
    }
  }
  for (const gate of gates) {
    const safeId = `GATE_${gate.replace(/[^A-Za-z0-9_]/g, '_')}`
    lines.push(`  ${safeId}["GATE: ${gate}"]`)
    for (const inv of invs) {
      const invSafe = inv.replace(/[^A-Za-z0-9_]/g, '_')
      lines.push(`  ${invSafe} -->|enforces| ${safeId}`)
    }
  }
  return lines.join('\n') + '\n'
}
