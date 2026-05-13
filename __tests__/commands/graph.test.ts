import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, afterEach } from 'vitest'
import { runGraphBuild, runVerifyGraph } from '../../src/commands/graph.js'
import { buildInvNodes } from '../../src/graph/builders/inv.js'
import type { Invariant } from '../../src/invariants/types.js'
import type { GraphSnapshot } from '../../src/graph/model.js'
import type { GraphFailure } from '../../src/commands/graph.js'

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

  it('result includes failures array (backward-compat)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-graph-failures-'))
    created.push(dir)
    const store = buildInvNodes(loadFixture('catalog-clean.json'))
    writeSnapshot(dir, store.snapshot())
    const result = runVerifyGraph({ dir })
    expect(Array.isArray(result.failures)).toBe(true)
  })
})

describe('verify graph — new failure classes (#259-followup)', () => {
  const created: string[] = []
  afterEach(() => {
    while (created.length > 0) {
      const dir = created.pop()
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('detects orphan-node: non-GATE node with no edges', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-orphan-node-'))
    created.push(dir)
    const snap: GraphSnapshot = {
      nodes: [
        { id: 'INV-01', kind: 'INV', attrs: {} },
        { id: 'GATE:foo', kind: 'GATE', attrs: {} },
        // FILE node with no edges — should be flagged
        { id: 'FILE:solo.ts', kind: 'FILE', attrs: {} },
      ],
      edges: [{ from: 'INV-01', to: 'GATE:foo', kind: 'enforces', attrs: {} }],
    }
    writeSnapshot(dir, snap)
    const result = runVerifyGraph({ dir })
    const orphanNodes = result.failures.filter((f: GraphFailure) => f.kind === 'orphan-node')
    expect(orphanNodes.map((f: GraphFailure) => f.id)).toContain('FILE:solo.ts')
  })

  it('GATE nodes are exempt from orphan-node check', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-gate-exempt-'))
    created.push(dir)
    const snap: GraphSnapshot = {
      nodes: [
        { id: 'INV-01', kind: 'INV', attrs: {} },
        { id: 'GATE:foo', kind: 'GATE', attrs: {} },
        // A standalone GATE with no edges — should NOT be flagged as orphan-node
        { id: 'GATE:bar', kind: 'GATE', attrs: {} },
      ],
      edges: [{ from: 'INV-01', to: 'GATE:foo', kind: 'enforces', attrs: {} }],
    }
    writeSnapshot(dir, snap)
    const result = runVerifyGraph({ dir })
    const orphanNodes = result.failures.filter((f: GraphFailure) => f.kind === 'orphan-node')
    expect(orphanNodes.map((f: GraphFailure) => f.id)).not.toContain('GATE:bar')
  })

  it('detects broken-ref: edge endpoint that does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-broken-ref-'))
    created.push(dir)
    const snap = {
      nodes: [{ id: 'INV-01', kind: 'INV', attrs: {} }],
      edges: [{ from: 'INV-01', to: 'GATE:nonexistent', kind: 'enforces', attrs: {} }],
    }
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', 'graph.json'),
      JSON.stringify(snap, null, 2) + '\n',
      'utf-8',
    )
    const result = runVerifyGraph({ dir })
    const broken = result.failures.filter((f: GraphFailure) => f.kind === 'broken-ref')
    expect(broken.length).toBeGreaterThan(0)
    expect(broken[0]?.reason).toContain('GATE:nonexistent')
  })

  it('detects missing-evidence: INV enforces GATE that lacks a produces edge', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-missing-evidence-'))
    created.push(dir)
    // For missing-evidence to trigger, the graph must have at least one produces edge
    // (indicating evidence infrastructure), but the specific GATE has no EVIDENCE.
    const snap: GraphSnapshot = {
      nodes: [
        { id: 'INV-01', kind: 'INV', attrs: {} },
        { id: 'GATE:foo', kind: 'GATE', attrs: {} },
        // GATE:bar has evidence; GATE:foo does not
        { id: 'GATE:bar', kind: 'GATE', attrs: {} },
        { id: 'EVIDENCE:abc', kind: 'EVIDENCE', attrs: {} },
      ],
      edges: [
        { from: 'INV-01', to: 'GATE:foo', kind: 'enforces', attrs: {} },
        // GATE:bar produces EVIDENCE but GATE:foo does not
        { from: 'GATE:bar', to: 'EVIDENCE:abc', kind: 'produces', attrs: {} },
      ],
    }
    writeSnapshot(dir, snap)
    const result = runVerifyGraph({ dir })
    const missing = result.failures.filter((f: GraphFailure) => f.kind === 'missing-evidence')
    expect(missing.length).toBeGreaterThan(0)
    expect(missing[0]?.id).toBe('INV-01')
  })

  it('no missing-evidence when every enforced GATE produces EVIDENCE', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-has-evidence-'))
    created.push(dir)
    const snap: GraphSnapshot = {
      nodes: [
        { id: 'INV-01', kind: 'INV', attrs: {} },
        { id: 'GATE:foo', kind: 'GATE', attrs: {} },
        { id: 'EVIDENCE:abc', kind: 'EVIDENCE', attrs: {} },
      ],
      edges: [
        { from: 'INV-01', to: 'GATE:foo', kind: 'enforces', attrs: {} },
        { from: 'GATE:foo', to: 'EVIDENCE:abc', kind: 'produces', attrs: {} },
      ],
    }
    writeSnapshot(dir, snap)
    const result = runVerifyGraph({ dir })
    const missing = result.failures.filter((f: GraphFailure) => f.kind === 'missing-evidence')
    expect(missing).toHaveLength(0)
  })

  it('detects stale-prover: TEST node whose path does not exist on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-stale-prover-'))
    created.push(dir)
    const snap: GraphSnapshot = {
      nodes: [
        { id: 'INV-01', kind: 'INV', attrs: {} },
        { id: 'GATE:foo', kind: 'GATE', attrs: {} },
        { id: 'EVIDENCE:abc', kind: 'EVIDENCE', attrs: {} },
        // TEST node with a path that does NOT exist on disk
        {
          id: 'TEST:__tests__/ghost.test.ts',
          kind: 'TEST',
          attrs: { path: '__tests__/ghost.test.ts' },
        },
      ],
      edges: [
        { from: 'INV-01', to: 'GATE:foo', kind: 'enforces', attrs: {} },
        { from: 'GATE:foo', to: 'EVIDENCE:abc', kind: 'produces', attrs: {} },
        { from: 'TEST:__tests__/ghost.test.ts', to: 'INV-01', kind: 'proves', attrs: {} },
      ],
    }
    writeSnapshot(dir, snap)
    const result = runVerifyGraph({ dir })
    const stale = result.failures.filter((f: GraphFailure) => f.kind === 'stale-prover')
    expect(stale.length).toBe(1)
    expect(stale[0]?.id).toContain('ghost.test.ts')
  })
})

describe('graph build — full-graph formats (#259-followup)', () => {
  const created: string[] = []
  afterEach(() => {
    while (created.length > 0) {
      const dir = created.pop()
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes dot format when --format dot is specified', () => {
    const dir = mkdtempSync(join(tmpdir(), 'graph-dot-'))
    created.push(dir)
    const result = runGraphBuild({ dir, format: 'dot' })
    expect(result.status).toBe('ok')
    const content = readFileSync(result.path, 'utf-8')
    expect(content.startsWith('digraph G {')).toBe(true)
    expect(content).toContain('rankdir=LR')
  })

  it('writes mermaid format when --format mermaid is specified', () => {
    const dir = mkdtempSync(join(tmpdir(), 'graph-mermaid-'))
    created.push(dir)
    const result = runGraphBuild({ dir, format: 'mermaid' })
    expect(result.status).toBe('ok')
    const content = readFileSync(result.path, 'utf-8')
    expect(content.startsWith('graph LR')).toBe(true)
  })

  it('defaults to json format', () => {
    const dir = mkdtempSync(join(tmpdir(), 'graph-default-'))
    created.push(dir)
    const result = runGraphBuild({ dir })
    expect(result.path).toMatch(/\.json$/)
    const content = readFileSync(result.path, 'utf-8')
    const parsed: unknown = JSON.parse(content)
    expect(parsed).toBeTypeOf('object')
  })

  it('uses different output paths for each format', () => {
    const dir = mkdtempSync(join(tmpdir(), 'graph-paths-'))
    created.push(dir)
    const jsonResult = runGraphBuild({ dir, format: 'json' })
    const dotResult = runGraphBuild({ dir, format: 'dot' })
    const mermaidResult = runGraphBuild({ dir, format: 'mermaid' })
    expect(jsonResult.path).toMatch(/graph\.json$/)
    expect(dotResult.path).toMatch(/graph\.dot$/)
    expect(mermaidResult.path).toMatch(/graph\.mermaid$/)
  })
})
