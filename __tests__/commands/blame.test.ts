/**
 * Tests for src/commands/blame.ts — `arbiter blame` command (#263).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { runBlame, type BlameFormat } from '../../src/commands/blame.js'
import { buildInvNodes } from '../../src/graph/builders/inv.js'
import type { GraphSnapshot } from '../../src/graph/model.js'

const fixtureInv = [
  {
    id: 'INV-01',
    tier: 'architectural',
    title: 'No circular dependencies between modules',
    description: 'Circular imports create tight coupling.',
    alwaysActive: true,
    enforcement: 'CI (madge)',
  },
] as const

function setupGraph(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'blame-test-'))
  const store = buildInvNodes(fixtureInv as never)
  const snap: GraphSnapshot = store.snapshot()
  const path = join(dir, '.arbiter', 'graph.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(snap, null, 2) + '\n', 'utf-8')
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('runBlame (#263, blame command)', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()
      if (fn !== undefined) fn()
    }
  })

  it('returns ok status for a known node', () => {
    const { dir, cleanup } = setupGraph()
    cleanups.push(cleanup)
    const result = runBlame({ from: 'INV-01', dir, skipGitLog: true })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
  })

  it('returns text format by default', () => {
    const { dir, cleanup } = setupGraph()
    cleanups.push(cleanup)
    const result = runBlame({ from: 'INV-01', dir, skipGitLog: true })
    expect(result.format).toBe('text')
    expect(result.output).toContain('INV-01')
  })

  it('returns json format when requested', () => {
    const { dir, cleanup } = setupGraph()
    cleanups.push(cleanup)
    const result = runBlame({ from: 'INV-01', dir, format: 'json', skipGitLog: true })
    expect(result.format).toBe('json')
    expect(() => JSON.parse(result.output)).not.toThrow()
    const parsed = JSON.parse(result.output) as { nodeId: string }
    expect(parsed.nodeId).toBe('INV-01')
  })

  it('returns mermaid format when requested', () => {
    const { dir, cleanup } = setupGraph()
    cleanups.push(cleanup)
    const result = runBlame({ from: 'INV-01', dir, format: 'mermaid', skipGitLog: true })
    expect(result.format).toBe('mermaid')
    expect(result.output.length).toBeGreaterThan(0)
  })

  it('returns markdown-audit format when requested', () => {
    const { dir, cleanup } = setupGraph()
    cleanups.push(cleanup)
    const result = runBlame({
      from: 'INV-01',
      dir,
      format: 'markdown-audit',
      skipGitLog: true,
    })
    expect(result.format).toBe('markdown-audit')
    expect(result.output).toMatch(/^#/m)
  })

  it('rejects unknown format', () => {
    const { dir, cleanup } = setupGraph()
    cleanups.push(cleanup)
    const result = runBlame({
      from: 'INV-01',
      dir,
      format: 'yaml' as BlameFormat,
      skipGitLog: true,
    })
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/unknown format/)
  })

  it('errors when graph.json is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'blame-missing-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const result = runBlame({ from: 'INV-01', dir, skipGitLog: true })
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/not found/)
  })

  it('errors on unknown node id', () => {
    const { dir, cleanup } = setupGraph()
    cleanups.push(cleanup)
    const result = runBlame({ from: 'INV-999', dir, skipGitLog: true })
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/unknown node/)
  })
})

describe('runBlame model.ts temporal fields (#263, backward-compat)', () => {
  it('GraphNode accepts optional created_at and commit_ref fields', () => {
    // Compile-time type check: if GraphNode interface accepts temporal fields,
    // this assignment is valid at the TypeScript level. Verified by tsc.
    const node: import('../../src/graph/model.js').GraphNode = {
      id: 'INV-01',
      kind: 'INV',
      attrs: {},
      created_at: '2024-11-03T10:00:00+00:00',
      commit_ref: 'abc1234',
    }
    expect(node.created_at).toBe('2024-11-03T10:00:00+00:00')
    expect(node.commit_ref).toBe('abc1234')
  })
})
