import { describe, it, expect } from 'vitest'
import { GraphStore, storeFromSnapshot } from '../../src/graph/store.js'
import type { GraphNode, GraphEdge } from '../../src/graph/model.js'

function n(id: string, kind: GraphNode['kind'] = 'INV'): GraphNode {
  return { id, kind, attrs: {} }
}

function e(from: string, to: string, kind: GraphEdge['kind'] = 'enforces'): GraphEdge {
  return { from, to, kind, attrs: {} }
}

describe('GraphStore (#259)', () => {
  it('stores and retrieves nodes', () => {
    const store = new GraphStore()
    store.addNode(n('INV-01'))
    expect(store.getNode('INV-01')?.id).toBe('INV-01')
    expect(store.hasNode('INV-01')).toBe(true)
    expect(store.hasNode('INV-02')).toBe(false)
  })

  it('rejects duplicate node ids on addNode', () => {
    const store = new GraphStore()
    store.addNode(n('INV-01'))
    expect(() => store.addNode(n('INV-01'))).toThrow(/duplicate node id/)
  })

  it('upsertNode is idempotent', () => {
    const store = new GraphStore()
    store.upsertNode(n('INV-01'))
    store.upsertNode(n('INV-01'))
    expect(store.allNodes()).toHaveLength(1)
  })

  it('rejects edges with unknown endpoints', () => {
    const store = new GraphStore()
    store.addNode(n('INV-01'))
    expect(() => store.addEdge(e('INV-01', 'INV-02'))).toThrow(/unknown node/)
    expect(() => store.addEdge(e('INV-02', 'INV-01'))).toThrow(/unknown node/)
  })

  it('deduplicates edges by (from, to, kind)', () => {
    const store = new GraphStore()
    store.addNode(n('INV-01'))
    store.addNode(n('GATE:x', 'GATE'))
    store.addEdge(e('INV-01', 'GATE:x'))
    store.addEdge(e('INV-01', 'GATE:x'))
    expect(store.allEdges()).toHaveLength(1)
  })

  it('queries outgoing/incoming with optional kind filter', () => {
    const store = new GraphStore()
    store.addNode(n('INV-01'))
    store.addNode(n('GATE:x', 'GATE'))
    store.addNode(n('FILE:y', 'FILE'))
    store.addEdge(e('INV-01', 'GATE:x', 'enforces'))
    store.addEdge(e('FILE:y', 'INV-01', 'implements'))

    expect(store.outgoing('INV-01')).toHaveLength(1)
    expect(store.outgoing('INV-01', 'enforces')).toHaveLength(1)
    expect(store.outgoing('INV-01', 'implements')).toHaveLength(0)
    expect(store.incoming('INV-01')).toHaveLength(1)
    expect(store.incoming('INV-01', 'implements')).toHaveLength(1)
  })

  it('neighbors returns both directions', () => {
    const store = new GraphStore()
    store.addNode(n('A'))
    store.addNode(n('B'))
    store.addNode(n('C'))
    store.addEdge(e('A', 'B'))
    store.addEdge(e('C', 'A'))
    const nb = store.neighbors('A').map((x) => x.node.id)
    expect(nb.sort()).toEqual(['B', 'C'])
  })

  it('snapshot returns stable sorted nodes and edges', () => {
    const store = new GraphStore()
    store.addNode(n('INV-02'))
    store.addNode(n('INV-01'))
    store.addNode(n('GATE:b', 'GATE'))
    store.addNode(n('GATE:a', 'GATE'))
    store.addEdge(e('INV-02', 'GATE:b'))
    store.addEdge(e('INV-01', 'GATE:a'))
    const snap = store.snapshot()
    expect(snap.nodes.map((x) => x.id)).toEqual(['GATE:a', 'GATE:b', 'INV-01', 'INV-02'])
    expect(snap.edges.map((x) => `${x.from}->${x.to}`)).toEqual([
      'INV-01->GATE:a',
      'INV-02->GATE:b',
    ])
  })

  it('storeFromSnapshot round-trips a snapshot', () => {
    const original = new GraphStore()
    original.addNode(n('INV-01'))
    original.addNode(n('GATE:x', 'GATE'))
    original.addEdge(e('INV-01', 'GATE:x'))
    const rehydrated = storeFromSnapshot(original.snapshot())
    expect(rehydrated.allNodes()).toHaveLength(2)
    expect(rehydrated.allEdges()).toHaveLength(1)
    expect(rehydrated.outgoing('INV-01', 'enforces')).toHaveLength(1)
  })

  it('nodesByKind filters by kind', () => {
    const store = new GraphStore()
    store.addNode(n('INV-01'))
    store.addNode(n('INV-02'))
    store.addNode(n('GATE:x', 'GATE'))
    expect(store.nodesByKind('INV')).toHaveLength(2)
    expect(store.nodesByKind('GATE')).toHaveLength(1)
    expect(store.nodesByKind('FILE')).toHaveLength(0)
  })
})
