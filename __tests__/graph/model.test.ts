import { describe, it, expect } from 'vitest'
import { ALL_NODE_KINDS, ALL_EDGE_KINDS, isNodeKind, isEdgeKind } from '../../src/graph/model.js'

describe('graph model (#259)', () => {
  it('declares exactly 9 node kinds', () => {
    expect(ALL_NODE_KINDS).toHaveLength(9)
    expect(new Set(ALL_NODE_KINDS).size).toBe(9)
    expect(ALL_NODE_KINDS).toEqual([
      'INV',
      'ADR',
      'REQ',
      'CANON',
      'FILE',
      'SYMBOL',
      'TEST',
      'EVIDENCE',
      'GATE',
    ])
  })

  it('declares exactly 8 edge kinds', () => {
    expect(ALL_EDGE_KINDS).toHaveLength(8)
    expect(new Set(ALL_EDGE_KINDS).size).toBe(8)
    expect(ALL_EDGE_KINDS).toEqual([
      'enforces',
      'decides',
      'demands',
      'implements',
      'proves',
      'produces',
      'supersedes',
      'promotes',
    ])
  })

  it('validates node kinds via type guard', () => {
    expect(isNodeKind('INV')).toBe(true)
    expect(isNodeKind('GATE')).toBe(true)
    expect(isNodeKind('not-a-kind')).toBe(false)
    expect(isNodeKind('')).toBe(false)
  })

  it('validates edge kinds via type guard', () => {
    expect(isEdgeKind('enforces')).toBe(true)
    expect(isEdgeKind('supersedes')).toBe(true)
    expect(isEdgeKind('not-a-kind')).toBe(false)
  })
})
