import type { GraphEdge, GraphNode, GraphSnapshot, EdgeKind, NodeKind } from './model.js'

/**
 * In-memory provenance graph store (#259).
 *
 * Deterministic by construction:
 *   - Nodes are keyed by id; later writes with the same id REJECT (throw) by
 *     default — duplicates are almost always a builder bug, not intent.
 *   - Edges are deduplicated by the (from, to, kind) triple.
 *   - `snapshot()` returns nodes sorted by id and edges sorted lexicographically
 *     by (from, kind, to), so JSON output is byte-stable across runs.
 *
 * The store is intentionally small: builders feed it, queries read it,
 * commands serialise it. No mutation API beyond add* is exposed.
 */
export class GraphStore {
  private readonly nodes = new Map<string, GraphNode>()
  private readonly edges = new Map<string, GraphEdge>()

  /** Add a node. Throws if a node with the same id already exists. */
  addNode(node: GraphNode): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`graph: duplicate node id "${node.id}"`)
    }
    this.nodes.set(node.id, node)
  }

  /**
   * Add a node idempotently — if it already exists, leave the existing one
   * untouched. Useful when several builders converge on the same FILE/SYMBOL.
   */
  upsertNode(node: GraphNode): void {
    if (!this.nodes.has(node.id)) {
      this.nodes.set(node.id, node)
    }
  }

  /**
   * Add an edge. Duplicate (from, to, kind) triples are silently coalesced.
   * Both endpoints must already exist in the store — dangling edges are a
   * builder bug.
   */
  addEdge(edge: GraphEdge): void {
    if (!this.nodes.has(edge.from)) {
      throw new Error(`graph: edge from unknown node "${edge.from}"`)
    }
    if (!this.nodes.has(edge.to)) {
      throw new Error(`graph: edge to unknown node "${edge.to}"`)
    }
    const key = edgeKey(edge)
    if (!this.edges.has(key)) {
      this.edges.set(key, edge)
    }
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id)
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id)
  }

  /** All outgoing edges from a node. Optionally filtered by edge kind. */
  outgoing(id: string, kind?: EdgeKind): GraphEdge[] {
    const out: GraphEdge[] = []
    for (const edge of this.edges.values()) {
      if (edge.from !== id) continue
      if (kind !== undefined && edge.kind !== kind) continue
      out.push(edge)
    }
    return out
  }

  /** All incoming edges to a node. Optionally filtered by edge kind. */
  incoming(id: string, kind?: EdgeKind): GraphEdge[] {
    const out: GraphEdge[] = []
    for (const edge of this.edges.values()) {
      if (edge.to !== id) continue
      if (kind !== undefined && edge.kind !== kind) continue
      out.push(edge)
    }
    return out
  }

  /**
   * Direct neighbours of a node in both directions. Returns a deduplicated
   * list of (node, edge) pairs — the edge tells the caller which direction
   * the neighbour was reached from.
   */
  neighbors(id: string): readonly { node: GraphNode; edge: GraphEdge }[] {
    const result: { node: GraphNode; edge: GraphEdge }[] = []
    for (const edge of this.outgoing(id)) {
      const node = this.nodes.get(edge.to)
      if (node !== undefined) result.push({ node, edge })
    }
    for (const edge of this.incoming(id)) {
      const node = this.nodes.get(edge.from)
      if (node !== undefined) result.push({ node, edge })
    }
    return result
  }

  allNodes(): readonly GraphNode[] {
    return Array.from(this.nodes.values())
  }

  allEdges(): readonly GraphEdge[] {
    return Array.from(this.edges.values())
  }

  nodesByKind(kind: NodeKind): readonly GraphNode[] {
    const out: GraphNode[] = []
    for (const node of this.nodes.values()) {
      if (node.kind === kind) out.push(node)
    }
    return out
  }

  /**
   * Stable snapshot — nodes sorted by id, edges sorted by (from, kind, to).
   * Used by the JSON serialiser and tests so that golden files are byte-stable.
   */
  snapshot(): GraphSnapshot {
    const nodes = Array.from(this.nodes.values()).sort((a, b) => compareIds(a.id, b.id))
    const edges = Array.from(this.edges.values()).sort((a, b) => {
      const f = compareIds(a.from, b.from)
      if (f !== 0) return f
      const k = a.kind.localeCompare(b.kind)
      if (k !== 0) return k
      return compareIds(a.to, b.to)
    })
    return { nodes, edges }
  }
}

function edgeKey(edge: GraphEdge): string {
  return `${edge.from} ${edge.kind} ${edge.to}`
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Re-hydrate a snapshot (e.g. parsed from graph.json) back into a store. */
export function storeFromSnapshot(snapshot: GraphSnapshot): GraphStore {
  const store = new GraphStore()
  for (const node of snapshot.nodes) {
    store.addNode(node)
  }
  for (const edge of snapshot.edges) {
    store.addEdge(edge)
  }
  return store
}
