/**
 * Tests for graph/load.ts — snapshot loader with schema validation (#1022).
 *
 * Covers: loadGraphSnapshot schema guard; valid snapshots accepted;
 * malformed snapshots rejected before bare-cast acceptance.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadGraphSnapshot } from '../../src/graph/load.js'

function withTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-graph-load-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const VALID_NODE = { id: 'INV-04', kind: 'INV', attrs: {} }
const VALID_EDGE = { from: 'INV-04', to: 'src/foo.ts', kind: 'implements', attrs: {} }

describe('loadGraphSnapshot (#1022)', () => {
  let env: ReturnType<typeof withTempDir>
  beforeEach(() => {
    env = withTempDir()
  })
  afterEach(() => env.cleanup())

  function write(name: string, content: unknown): string {
    const path = join(env.dir, name)
    writeFileSync(path, JSON.stringify(content), 'utf-8')
    return path
  }

  it('returns ok: false when file does not exist', () => {
    const result = loadGraphSnapshot(join(env.dir, 'nonexistent.json'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/not found/)
  })

  it('accepts a valid empty snapshot', () => {
    const path = write('graph.json', { nodes: [], edges: [] })
    const result = loadGraphSnapshot(path)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot.nodes).toHaveLength(0)
      expect(result.snapshot.edges).toHaveLength(0)
    }
  })

  it('accepts a snapshot with valid nodes and edges', () => {
    const path = write('graph.json', { nodes: [VALID_NODE], edges: [VALID_EDGE] })
    const result = loadGraphSnapshot(path)
    expect(result.ok).toBe(true)
  })

  it('rejects a snapshot missing nodes array', () => {
    const path = write('graph.json', { edges: [] })
    const result = loadGraphSnapshot(path)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/schema validation/)
  })

  it('rejects a snapshot missing edges array', () => {
    const path = write('graph.json', { nodes: [] })
    const result = loadGraphSnapshot(path)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/schema validation/)
  })

  it('rejects a node with unknown kind', () => {
    const path = write('graph.json', {
      nodes: [{ id: 'X-1', kind: 'UNKNOWN_KIND', attrs: {} }],
      edges: [],
    })
    const result = loadGraphSnapshot(path)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/schema validation/)
  })

  it('rejects a node with missing id', () => {
    const path = write('graph.json', {
      nodes: [{ kind: 'INV', attrs: {} }],
      edges: [],
    })
    const result = loadGraphSnapshot(path)
    expect(result.ok).toBe(false)
  })

  it('rejects a node with missing attrs', () => {
    const path = write('graph.json', {
      nodes: [{ id: 'INV-04', kind: 'INV' }],
      edges: [],
    })
    const result = loadGraphSnapshot(path)
    expect(result.ok).toBe(false)
  })

  it('rejects an edge with unknown kind', () => {
    const path = write('graph.json', {
      nodes: [],
      edges: [{ from: 'A', to: 'B', kind: 'unknown_edge', attrs: {} }],
    })
    const result = loadGraphSnapshot(path)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/schema validation/)
  })

  it('rejects an edge with missing to field', () => {
    const path = write('graph.json', {
      nodes: [],
      edges: [{ from: 'A', kind: 'implements', attrs: {} }],
    })
    const result = loadGraphSnapshot(path)
    expect(result.ok).toBe(false)
  })

  it('rejects non-JSON content', () => {
    const path = join(env.dir, 'graph.json')
    writeFileSync(path, 'not json', 'utf-8')
    const result = loadGraphSnapshot(path)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/failed to parse/)
  })

  it('rejects JSON array instead of object', () => {
    const path = write('graph.json', [])
    const result = loadGraphSnapshot(path)
    expect(result.ok).toBe(false)
  })

  it('accepts all valid NodeKind values', () => {
    const nodeKinds = ['INV', 'ADR', 'REQ', 'CANON', 'FILE', 'SYMBOL', 'TEST', 'EVIDENCE', 'GATE']
    for (const kind of nodeKinds) {
      const path = write('graph.json', { nodes: [{ id: `${kind}-1`, kind, attrs: {} }], edges: [] })
      const result = loadGraphSnapshot(path)
      expect(result.ok).toBe(true)
    }
  })

  it('accepts all valid EdgeKind values', () => {
    const edgeKinds = [
      'enforces',
      'decides',
      'demands',
      'implements',
      'proves',
      'produces',
      'supersedes',
      'promotes',
    ]
    for (const kind of edgeKinds) {
      const path = write('graph.json', {
        nodes: [],
        edges: [{ from: 'A', to: 'B', kind, attrs: {} }],
      })
      const result = loadGraphSnapshot(path)
      expect(result.ok).toBe(true)
    }
  })
})
