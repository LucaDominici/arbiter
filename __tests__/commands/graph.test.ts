import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, afterEach } from 'vitest'
import { runGraphBuild, runVerifyGraph } from '../../src/commands/graph.js'
import { buildInvNodes } from '../../src/graph/builders/inv.js'
import type { Invariant } from '../../src/invariants/types.js'
import type { GraphSnapshot } from '../../src/graph/model.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'graph')

function loadFixture(name: string): Invariant[] {
  const raw = readFileSync(join(FIXTURES_DIR, name), 'utf-8')
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('fixture is not an array')
  return parsed as Invariant[]
}

function writeSnapshot(dir: string, snapshot: GraphSnapshot): string {
  const out = join(dir, '.arbiter', 'graph.json')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8')
  return out
}

describe('graph build (#259, AC-3)', () => {
  const created: string[] = []
  afterEach(() => {
    while (created.length > 0) {
      const dir = created.pop()
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes .arbiter/graph.json with valid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'graph-build-'))
    created.push(dir)
    const result = runGraphBuild({ dir })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
    expect(result.path).toBe(join(dir, '.arbiter', 'graph.json'))
    expect(result.nodes).toBeGreaterThan(0)
    expect(result.edges).toBeGreaterThan(0)
    const parsed: unknown = JSON.parse(readFileSync(result.path, 'utf-8'))
    expect(parsed).toBeTypeOf('object')
    if (parsed === null || typeof parsed !== 'object') throw new Error()
    const obj = parsed as Record<string, unknown>
    expect(Array.isArray(obj['nodes'])).toBe(true)
    expect(Array.isArray(obj['edges'])).toBe(true)
  })

  it('output is byte-stable across runs (sorted)', () => {
    const dirA = mkdtempSync(join(tmpdir(), 'graph-build-a-'))
    const dirB = mkdtempSync(join(tmpdir(), 'graph-build-b-'))
    created.push(dirA, dirB)
    runGraphBuild({ dir: dirA })
    runGraphBuild({ dir: dirB })
    const a = readFileSync(join(dirA, '.arbiter', 'graph.json'), 'utf-8')
    const b = readFileSync(join(dirB, '.arbiter', 'graph.json'), 'utf-8')
    expect(a).toBe(b)
  })

  it('respects --output override', () => {
    const dir = mkdtempSync(join(tmpdir(), 'graph-build-out-'))
    created.push(dir)
    const out = join(dir, 'elsewhere.json')
    const result = runGraphBuild({ dir, output: out })
    expect(result.path).toBe(out)
    expect(readFileSync(out, 'utf-8').length).toBeGreaterThan(0)
  })
})

describe('verify graph (#259, AC-5)', () => {
  const created: string[] = []
  afterEach(() => {
    while (created.length > 0) {
      const dir = created.pop()
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes when every INV has an enforces edge (clean fixture)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-graph-clean-'))
    created.push(dir)
    const store = buildInvNodes(loadFixture('catalog-clean.json'))
    writeSnapshot(dir, store.snapshot())
    const result = runVerifyGraph({ dir })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
    expect(result.orphans).toEqual([])
    expect(result.totalInv).toBe(3)
  })

  it('fails on orphan invariant (orphan fixture)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-graph-orphan-'))
    created.push(dir)
    const store = buildInvNodes(loadFixture('catalog-orphan.json'))
    writeSnapshot(dir, store.snapshot())
    const result = runVerifyGraph({ dir })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(2)
    expect(result.orphans.map((o) => o.id)).toEqual(['INV-99'])
    expect(result.reason).toContain('INV-99')
  })

  it('passes when INV is reached via implements edge instead of enforces', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-graph-implements-'))
    created.push(dir)
    const snap: GraphSnapshot = {
      nodes: [
        { id: 'INV-99', kind: 'INV', attrs: {} },
        { id: 'FILE:x', kind: 'FILE', attrs: {} },
      ],
      edges: [{ from: 'FILE:x', to: 'INV-99', kind: 'implements', attrs: {} }],
    }
    writeSnapshot(dir, snap)
    const result = runVerifyGraph({ dir })
    expect(result.status).toBe('ok')
  })

  it('errors when graph.json is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-graph-missing-'))
    created.push(dir)
    const result = runVerifyGraph({ dir })
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/graph snapshot not found/)
  })

  it('errors on malformed JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-graph-bad-'))
    created.push(dir)
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(join(dir, '.arbiter', 'graph.json'), '{not json', 'utf-8')
    const result = runVerifyGraph({ dir })
    expect(result.status).toBe('error')
    expect(result.reason).toMatch(/failed to parse/)
  })
})
