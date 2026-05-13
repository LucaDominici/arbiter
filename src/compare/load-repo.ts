import { join, basename } from 'node:path'
import { existsSync } from 'node:fs'
import { GraphStore, storeFromSnapshot } from '../graph/store.js'
import { loadGraphSnapshot } from '../graph/load.js'
import { buildInvNodes } from '../graph/builders/inv.js'
import { INVARIANT_CATALOG } from '../invariants/catalog.js'
import { GRAPH_RELATIVE_PATH } from '../commands/graph.js'
import type { RepoData } from './model.js'

/**
 * Load a single repo's governance data for comparison (#264).
 *
 * Strategy:
 *   1. Try to load `.arbiter/graph.json` from the repo directory.
 *   2. If missing, fall back to building INV-only graph from the global
 *      INVARIANT_CATALOG (the repo has no custom graph — we still contribute
 *      the standard catalog entries so the comparison is not empty).
 *
 * Returns a structured `RepoData` and a warning string (or undefined) so the
 * caller can include fallback notices in the report.
 */
export interface LoadRepoOutcome {
  data: RepoData
  warning?: string | undefined
}

export function loadRepoData(repoPath: string): LoadRepoOutcome {
  const label = basename(repoPath) || repoPath
  const graphPath = join(repoPath, GRAPH_RELATIVE_PATH)

  let store: GraphStore
  let fromFallback = false
  let warning: string | undefined

  if (existsSync(graphPath)) {
    const loaded = loadGraphSnapshot(graphPath)
    if (loaded.ok) {
      store = storeFromSnapshot(loaded.snapshot)
    } else {
      // File exists but failed to parse — treat as empty graph
      store = new GraphStore()
      warning = `${label}: ${loaded.reason}`
      fromFallback = true
    }
  } else {
    // No graph.json — fall back to INV catalog
    store = buildInvNodes(INVARIANT_CATALOG)
    fromFallback = true
    warning = `${label}: no graph found at ${graphPath} — using INV catalog fallback`
  }

  // Build invIds set
  const invIds = new Set<string>()
  const invGates = new Map<string, Set<string>>()
  const invTiers = new Map<string, string>()
  const adrTitles = new Map<string, string>()

  for (const node of store.nodesByKind('INV')) {
    invIds.add(node.id)
    const gates = new Set<string>()
    for (const edge of store.outgoing(node.id, 'enforces')) {
      const gateNode = store.getNode(edge.to)
      if (gateNode !== undefined) {
        const mechanism = gateNode.attrs['mechanism']
        gates.add(typeof mechanism === 'string' ? mechanism : edge.to)
      }
    }
    invGates.set(node.id, gates)
    const tier = node.attrs['tier']
    invTiers.set(node.id, typeof tier === 'string' ? tier : 'unknown')
  }

  for (const node of store.nodesByKind('ADR')) {
    const title = node.attrs['title']
    adrTitles.set(node.id, typeof title === 'string' ? title : '')
  }

  return {
    data: {
      path: repoPath,
      label,
      invIds,
      invGates,
      invTiers,
      adrTitles,
      fromFallback,
    },
    warning,
  }
}
