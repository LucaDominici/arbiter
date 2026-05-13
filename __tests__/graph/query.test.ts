import { describe, it, expect } from 'vitest'
import { GraphStore } from '../../src/graph/store.js'
import { trace, toDot, toJson, toMermaid } from '../../src/graph/query.js'
import type { GraphNode, GraphEdge } from '../../src/graph/model.js'

function n(id: string, kind: GraphNode['kind'] = 'INV', title?: string): GraphNode {
  return { id, kind, attrs: title !== undefined ? { title } : {} }
}

function e(from: string, to: string, kind: GraphEdge['kind'] = 'enforces'): GraphEdge {
  return { from, to, kind, attrs: {} }
}

function buildChain(): GraphStore {
  // FILE -> implements -> INV-04 -> enforces -> GATE:eslint
  //                                          -> enforces -> GATE:hook
  //                       INV-04 -> proves    -> TEST:no-any  (semantically odd but exercises depth)
  const store = new GraphStore()
  store.addNode(n('INV-04', 'INV', 'No any'))
  store.addNode(n('GATE:eslint', 'GATE', 'eslint'))
  store.addNode(n('GATE:hook', 'GATE', 'hook'))
  store.addNode(n('FILE:src/x.ts', 'FILE', 'x.ts'))
  store.addNode(n('TEST:no-any', 'TEST', 'no-any test'))
  store.addNode(n('FAR', 'FILE', 'unrelated'))
  store.addEdge(e('INV-04', 'GATE:eslint', 'enforces'))
  store.addEdge(e('INV-04', 'GATE:hook', 'enforces'))
  store.addEdge(e('FILE:src/x.ts', 'INV-04', 'implements'))
  store.addEdge(e('INV-04', 'TEST:no-any', 'proves'))
  return store
}

describe('trace (#259)', () => {
  it('throws on unknown origin', () => {
    const store = new GraphStore()
    expect(() => trace(store, 'missing')).toThrow(/unknown node/)
  })

  it('returns just origin at depth 0', () => {
    const store = buildChain()
    const sub = trace(store, 'INV-04', { depth: 0 })
    expect(sub.nodes.map((x) => x.id)).toEqual(['INV-04'])
    expect(sub.edges).toHaveLength(0)
  })

  it('walks both directions at depth 1', () => {
    const store = buildChain()
    const sub = trace(store, 'INV-04', { depth: 1 })
    expect(sub.nodes.map((x) => x.id).sort()).toEqual([
      'FILE:src/x.ts',
      'GATE:eslint',
      'GATE:hook',
      'INV-04',
      'TEST:no-any',
    ])
    expect(sub.edges).toHaveLength(4)
    // FAR node is NOT included
    expect(sub.nodes.find((x) => x.id === 'FAR')).toBeUndefined()
  })

  it('excludes unreachable nodes from a deep walk', () => {
    const store = buildChain()
    const sub = trace(store, 'INV-04')
    expect(sub.nodes.find((x) => x.id === 'FAR')).toBeUndefined()
  })

  it('handles cycles without blowing up', () => {
    const store = new GraphStore()
    store.addNode(n('A'))
    store.addNode(n('B'))
    store.addEdge(e('A', 'B'))
    store.addEdge(e('B', 'A'))
    const sub = trace(store, 'A')
    expect(sub.nodes).toHaveLength(2)
  })

  it('respects maxNodes cap', () => {
    const store = new GraphStore()
    store.addNode(n('INV-00'))
    for (let i = 1; i <= 50; i++) {
      store.addNode(n(`GATE:${i}`, 'GATE'))
      store.addEdge(e('INV-00', `GATE:${i}`))
    }
    const sub = trace(store, 'INV-00', { maxNodes: 10 })
    expect(sub.nodes.length).toBeLessThanOrEqual(10)
  })
})

describe('renderers (#259, AC-9)', () => {
  it('toJson produces stable pretty-printed output', () => {
    const store = buildChain()
    const sub = trace(store, 'INV-04', { depth: 1 })
    const json = toJson(sub)
    expect(json).toContain('"nodes"')
    expect(json).toContain('"edges"')
    // Stable: same input → same output bytes
    expect(toJson(sub)).toBe(json)
    const parsed: unknown = JSON.parse(json)
    expect(parsed).toBeTypeOf('object')
  })

  it('toDot emits a valid Graphviz digraph', () => {
    const store = buildChain()
    const sub = trace(store, 'INV-04', { depth: 1 })
    const dot = toDot(sub)
    expect(dot.startsWith('digraph G {')).toBe(true)
    expect(dot.endsWith('}')).toBe(true)
    expect(dot).toContain('"INV-04"')
    expect(dot).toContain('label="enforces"')
    expect(dot).toContain('label="implements"')
  })

  it('toMermaid emits a graph LR block', () => {
    const store = buildChain()
    const sub = trace(store, 'INV-04', { depth: 1 })
    const md = toMermaid(sub)
    expect(md.split('\n')[0]).toBe('graph LR')
    expect(md).toContain('INV_04')
    expect(md).toContain('-->|enforces|')
    expect(md).toContain('-->|implements|')
  })

  it('renderers escape special characters in DOT', () => {
    const store = new GraphStore()
    store.addNode({
      id: 'WEIRD"id',
      kind: 'INV',
      attrs: { title: 'has "quotes"' },
    })
    const dot = toDot({ nodes: store.allNodes(), edges: [] })
    expect(dot).toContain('WEIRD\\"id')
  })
})
