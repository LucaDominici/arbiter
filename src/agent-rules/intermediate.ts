/**
 * Agent-rules intermediate format (#265).
 *
 * Derives a target-agnostic JSON document from the provenance graph
 * (or INV catalog fallback). This intermediate layer decouples the
 * graph model from the per-target emitters.
 *
 * Severity mapping (documented in DECISIONS.md):
 *   - tier ∈ {architectural, security, governance} → hard-stop (MANDATORY)
 *   - tier ∈ {data, operational} → advisory (RECOMMENDED)
 *   - unknown/other → advisory
 */

import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { GraphStore, storeFromSnapshot } from '../graph/store.js'
import { loadGraphSnapshot } from '../graph/load.js'
import { buildInvNodes } from '../graph/builders/inv.js'
import { INVARIANT_CATALOG } from '../invariants/catalog.js'
import { GRAPH_RELATIVE_PATH } from '../commands/graph.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type InvSeverity = 'hard-stop' | 'advisory'

export interface AgentRulesInvariant {
  id: string
  statement: string
  severity: InvSeverity
  enforcement: Array<{ type: 'gate'; ref: string }>
  applies_to: string[]
}

export interface AgentRulesWorkflow {
  trigger: string
  action: string
}

export interface AgentRulesIntermediate {
  schemaVersion: '1.0'
  repo: string
  invariants: AgentRulesInvariant[]
  workflows: AgentRulesWorkflow[]
}

// ─── Severity mapping ─────────────────────────────────────────────────────────

const HARD_STOP_TIERS = new Set<string>(['architectural', 'security', 'governance'])

export function severityFromTier(tier: string | undefined): InvSeverity {
  if (tier !== undefined && HARD_STOP_TIERS.has(tier)) return 'hard-stop'
  return 'advisory'
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export interface BuildIntermediateOptions {
  dir: string
  repoName?: string
}

export interface BuildIntermediateResult {
  intermediate: AgentRulesIntermediate
  fallbackUsed: boolean
}

export function buildIntermediate(opts: BuildIntermediateOptions): BuildIntermediateResult {
  const { dir } = opts
  const repoName = opts.repoName ?? extractRepoName(dir)

  const graphPath = join(dir, GRAPH_RELATIVE_PATH)
  let store: GraphStore
  let fallbackUsed = false

  if (existsSync(graphPath)) {
    const loaded = loadGraphSnapshot(graphPath)
    if (loaded.ok) {
      store = storeFromSnapshot(loaded.snapshot)
    } else {
      store = buildInvNodes(INVARIANT_CATALOG)
      fallbackUsed = true
    }
  } else {
    store = buildInvNodes(INVARIANT_CATALOG)
    fallbackUsed = true
  }

  const invariants: AgentRulesInvariant[] = []

  for (const node of store.nodesByKind('INV')) {
    const title = typeof node.attrs['title'] === 'string' ? node.attrs['title'] : node.id
    const tier = typeof node.attrs['tier'] === 'string' ? node.attrs['tier'] : undefined
    const severity = severityFromTier(tier)

    const enforcement: Array<{ type: 'gate'; ref: string }> = []
    for (const edge of store.outgoing(node.id, 'enforces')) {
      const gateNode = store.getNode(edge.to)
      if (gateNode !== undefined) {
        const mechanism =
          typeof gateNode.attrs['mechanism'] === 'string' ? gateNode.attrs['mechanism'] : edge.to
        enforcement.push({ type: 'gate', ref: mechanism })
      }
    }

    invariants.push({
      id: node.id,
      statement: title,
      severity,
      enforcement,
      applies_to: [], // FILE→INV edges not yet built in Wave-1
    })
  }

  // Sort by id for deterministic output
  invariants.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const workflows: AgentRulesWorkflow[] = [
    { trigger: 'before commit', action: 'run gate: node scripts/check-all.mjs L1' },
    { trigger: 'before push', action: 'run gate: node scripts/check-all.mjs L2' },
    { trigger: 'starting any task', action: 'read AGENTS.md and create task branch' },
  ]

  return {
    intermediate: {
      schemaVersion: '1.0',
      repo: repoName,
      invariants,
      workflows,
    },
    fallbackUsed,
  }
}

function extractRepoName(dir: string): string {
  const parts = dir.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? dir
}
