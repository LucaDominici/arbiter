import type { GraphEdge, GraphNode, GraphSnapshot } from './model.js'
import { GraphStore } from './store.js'

export interface TraceOptions {
  /** Maximum BFS depth. 0 = origin only, undefined = unlimited (but capped). */
  depth?: number
  /**
   * Hard cap to keep cycles from blowing up — at most this many nodes are
   * visited regardless of `depth`. Defaults to 1000.
   */
  maxNodes?: number
}

const DEFAULT_MAX_NODES = 1000

/**
 * Breadth-first trace from a starting node, walking edges in BOTH directions.
 * Returns the visited subgraph (nodes + edges) — useful for rendering the
 * provenance chain around an INV.
 *
 * Cycles are handled by a visited set; the optional `depth` argument limits
 * the radius. The result is a `GraphSnapshot` so the same renderers used by
 * `graph.json` work for trace output.
 */
export function trace(store: GraphStore, fromId: string, opts: TraceOptions = {}): GraphSnapshot {
  const origin = store.getNode(fromId)
  if (origin === undefined) {
    throw new Error(`graph trace: unknown node id "${fromId}"`)
  }

  const depth = opts.depth ?? Number.POSITIVE_INFINITY
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES

  const visited = new Set<string>([origin.id])
  const nodes: GraphNode[] = [origin]
  const edges: GraphEdge[] = []
  const edgeSeen = new Set<string>()

  let frontier: string[] = [origin.id]
  let currentDepth = 0

  while (frontier.length > 0 && currentDepth < depth && nodes.length < maxNodes) {
    const next: string[] = []
    for (const id of frontier) {
      expandNeighbours({ store, id, visited, edgeSeen, nodes, edges, next, maxNodes })
      if (nodes.length >= maxNodes) break
    }
    frontier = next
    currentDepth += 1
  }

  // Stable order so renderers are deterministic.
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  edges.sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1
    return a.to < b.to ? -1 : a.to > b.to ? 1 : 0
  })

  return { nodes, edges }
}

interface ExpandArgs {
  store: GraphStore
  id: string
  visited: Set<string>
  edgeSeen: Set<string>
  nodes: GraphNode[]
  edges: GraphEdge[]
  next: string[]
  maxNodes: number
}

function expandNeighbours(args: ExpandArgs): void {
  const { store, id, visited, edgeSeen, nodes, edges, next, maxNodes } = args
  for (const { node, edge } of store.neighbors(id)) {
    const key = `${edge.from} ${edge.kind} ${edge.to}`
    if (!edgeSeen.has(key)) {
      edgeSeen.add(key)
      edges.push(edge)
    }
    if (visited.has(node.id)) continue
    visited.add(node.id)
    nodes.push(node)
    next.push(node.id)
    if (nodes.length >= maxNodes) return
  }
}

/** Render a snapshot as a stable, pretty-printed JSON document. */
export function toJson(snapshot: GraphSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}

/**
 * Render as Graphviz DOT. Node ids are quoted to handle dashes / colons.
 *
 *   digraph G {
 *     "INV-04" [label="INV-04\n…", shape=box];
 *     "INV-04" -> "GATE:no-explicit-any" [label="enforces"];
 *   }
 */
export function toDot(snapshot: GraphSnapshot): string {
  const lines: string[] = ['digraph G {', '  rankdir=LR;', '  node [shape=box];']
  for (const node of snapshot.nodes) {
    const title = typeof node.attrs['title'] === 'string' ? node.attrs['title'] : node.id
    const label = `${node.kind}: ${title}`
    lines.push(`  ${quoteDot(node.id)} [label=${quoteDot(label)}];`)
  }
  for (const edge of snapshot.edges) {
    lines.push(`  ${quoteDot(edge.from)} -> ${quoteDot(edge.to)} [label="${edge.kind}"];`)
  }
  lines.push('}')
  return lines.join('\n')
}

/**
 * Render as a Mermaid `graph LR` block. Mermaid is stricter about node ids
 * than DOT, so we substitute dashes/colons with underscores and keep the
 * human-readable id inside the label.
 */
export function toMermaid(snapshot: GraphSnapshot): string {
  const lines: string[] = ['graph LR']
  for (const node of snapshot.nodes) {
    const safeId = mermaidId(node.id)
    const title = typeof node.attrs['title'] === 'string' ? node.attrs['title'] : node.id
    lines.push(`  ${safeId}["${node.kind}: ${escapeMermaidLabel(title)}"]`)
  }
  for (const edge of snapshot.edges) {
    lines.push(`  ${mermaidId(edge.from)} -->|${edge.kind}| ${mermaidId(edge.to)}`)
  }
  return lines.join('\n')
}

function quoteDot(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function mermaidId(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, '_')
}

function escapeMermaidLabel(s: string): string {
  return s.replace(/"/g, '#quot;')
}
