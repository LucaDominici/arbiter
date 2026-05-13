import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { runTrace } from '../../src/commands/trace.js'
import { buildInvNodes } from '../../src/graph/builders/inv.js'
import type { GraphSnapshot } from '../../src/graph/model.js'

const fixtureClean = [
  {
    id: 'INV-04',
    tier: 'architectural',
    title: 'No any',
    description: 'fixture',
    alwaysActive: true,
    enforcement: 'hook + CI (ESLint no-explicit-any); local gate: `npm run lint`',
  },
] as const

function setupGraph(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'trace-test-'))
  const store = buildInvNodes(fixtureClean as never)
  const snap: GraphSnapshot = store.snapshot()
  const path = join(dir, '.arbiter', 'graph.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(snap, null, 2) + '\n', 'utf-8')
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('trace command (#259, AC-4 + AC-9)', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()
      if (fn !== undefined) fn()
    }
  })

  it('returns json by default and includes the origin', () => {
    const { dir, cleanup } = setupGraph()
    cleanups.push(cleanup)
    const result = runTrace({ from: 'INV-04', dir })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
    expect(result.format).toBe('json')
    const parsed: unknown = JSON.parse(result.output)
    expect(parsed).toBeTypeOf('object')
    if (parsed === null || typeof parsed !== 'object') throw new Error()
    const obj = parsed as Record<string, unknown>
    const nodes = obj['nodes'] as Array<{ id: string }>
    expect(nodes.map((n) => n.id)).toContain('INV-04')
  })

  it('renders dot format', () => {
    const { dir, cleanup } = setupGraph()
    cleanups.push(cleanup)
    const result = runTrace({ from: 'INV-04', dir, format: 'dot' })
    expect(result.status).toBe('ok')
    expect(result.format).toBe('dot')
    expect(result.output.startsWith('digraph G {')).toBe(true)
    expect(result.output).toContain('"INV-04"')
  })

  it('renders mermaid format', () => {
    const { dir, cleanup } = setupGraph()
    cleanups.push(cleanup)
    const result = runTrace({ from: 'INV-04', dir, format: 'mermaid' })
    expect(result.status).toBe('ok')
    expect(result.format).toBe('mermaid')
    expect(result.output.startsWith('graph LR')).toBe(true)
  })

  it('respects --depth 0 (origin only)', () => {
    const { dir, cleanup } = setupGraph()
    cleanups.push(cleanup)
    const result = runTrace({ from: 'INV-04', dir, depth: 0 })
    expect(result.status).toBe('ok')
    const parsed = JSON.parse(result.output) as { nodes: Array<{ id: string }> }
    expect(parsed.nodes).toHaveLength(1)
    expect(parsed.nodes[0]?.id).toBe('INV-04')
  })

  it('rejects unknown format', () => {
    const { dir, cleanup } = setupGraph()
    cleanups.push(cleanup)
    const result = runTrace({
      from: 'INV-04',
      dir,
      format: 'yaml' as never,
    })
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/unknown format/)
  })

  it('errors when graph.json is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trace-missing-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const result = runTrace({ from: 'INV-04', dir })
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/not found/)
  })

  it('errors on unknown origin node', () => {
    const { dir, cleanup } = setupGraph()
    cleanups.push(cleanup)
    const result = runTrace({ from: 'INV-999', dir })
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/unknown node id/)
  })
})
