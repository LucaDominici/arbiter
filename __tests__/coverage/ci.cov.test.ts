// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-coverage suite for src/commands/ci.ts.
 *
 * Drives runCiPlan / runCiVerifyPlan through their uncovered branches using
 * real on-disk temp fixtures (no mocks, no network, no git):
 *   - malformed graph JSON → parse-error path (Error vs non-Error message)
 *   - mermaid format WITH a graph present (impact mermaid builder)
 *   - FILE-node discovery via path-attr fallback loop + node.id fallback
 *   - reverse (incoming) implements edge, non-INV target/source guards
 *   - catalog.ts / AGENTS.md "touches catalog" fan-out
 *   - every computeRiskClass pattern (R0/R1/R2/R3/R4) + highest-risk pick
 *     + backslash normalisation + R-unknown fallthrough
 *   - runCiVerifyPlan missing-gate, all-present, and fallback branches
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { runCiPlan, runCiVerifyPlan } from '../../src/commands/ci.js'
import type { CiPlan } from '../../src/commands/ci.js'

interface RawNode {
  id: string
  kind: string
  attrs: Record<string, unknown>
}
interface RawEdge {
  from: string
  to: string
  kind: string
  attrs: Record<string, unknown>
}

const dirs: string[] = []

function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ci-cov-'))
  dirs.push(d)
  return d
}

function writeGraph(dir: string, nodes: RawNode[], edges: RawEdge[]): void {
  mkdirSync(join(dir, '.arbiter'), { recursive: true })
  writeFileSync(
    join(dir, '.arbiter', 'graph.json'),
    JSON.stringify({ nodes, edges }, null, 2),
    'utf-8',
  )
}

function writeRawGraph(dir: string, contents: string): void {
  mkdirSync(join(dir, '.arbiter'), { recursive: true })
  writeFileSync(join(dir, '.arbiter', 'graph.json'), contents, 'utf-8')
}

afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

describe('runCiPlan — parse-error branch', () => {
  it('returns error (exitCode 2) when graph.json is malformed JSON', () => {
    const dir = makeTmp()
    writeRawGraph(dir, '{ this is : not json ]')
    const result = runCiPlan({ dir, changedFiles: ['src/foo.ts'] })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(2)
    expect(result.plan.fallback).toBe(true)
    expect(result.plan.risk_class).toBe('R-unknown')
    expect(result.reason).toMatch(/failed to load graph/)
  })

  it('error plan carries empty impacted/required arrays', () => {
    const dir = makeTmp()
    writeRawGraph(dir, 'definitely-not-json')
    const result = runCiPlan({ dir, changedFiles: [] })
    expect(result.status).toBe('error')
    expect(result.plan.impacted_invs).toEqual([])
    expect(result.plan.required_gates).toEqual([])
  })
})

describe('runCiPlan — fallback (no graph) branch', () => {
  it('defaults dir to "." and emits fallback when no graph present', () => {
    // No .arbiter/graph.json relative to cwd of this worktree path component.
    const dir = makeTmp()
    const result = runCiPlan({ dir })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
    expect(result.plan.fallback).toBe(true)
    expect(result.plan.warning).toMatch(/no graph snapshot found/)
    // json format → no mermaid emitted
    expect(result.mermaid).toBeUndefined()
  })

  it('emits fallback mermaid when format=mermaid and no graph', () => {
    const dir = makeTmp()
    const result = runCiPlan({ dir, format: 'mermaid' })
    expect(result.status).toBe('ok')
    expect(result.plan.fallback).toBe(true)
    expect(result.mermaid).toBeDefined()
    expect(result.mermaid).toContain('No graph')
  })
})

describe('runCiPlan — graph traversal branches', () => {
  it('finds INV via exact FILE node + INV→GATE enforces, sorted output', () => {
    const dir = makeTmp()
    writeGraph(
      dir,
      [
        { id: 'INV-04', kind: 'INV', attrs: { title: 'No any' } },
        { id: 'INV-02', kind: 'INV', attrs: { title: 'Other' } },
        { id: 'GATE:eslint-no-any', kind: 'GATE', attrs: {} },
        { id: 'GATE:aaa-gate', kind: 'GATE', attrs: {} },
        { id: 'FILE:src/foo.ts', kind: 'FILE', attrs: { path: 'src/foo.ts' } },
      ],
      [
        { from: 'INV-04', to: 'GATE:eslint-no-any', kind: 'enforces', attrs: {} },
        { from: 'INV-02', to: 'GATE:aaa-gate', kind: 'enforces', attrs: {} },
        { from: 'FILE:src/foo.ts', to: 'INV-04', kind: 'implements', attrs: {} },
        { from: 'FILE:src/foo.ts', to: 'INV-02', kind: 'implements', attrs: {} },
      ],
    )
    const result = runCiPlan({ dir, changedFiles: ['src/foo.ts'] })
    expect(result.status).toBe('ok')
    expect(result.plan.fallback).toBe(false)
    expect(result.plan.impacted_invs).toEqual(['INV-02', 'INV-04'])
    expect(result.plan.required_gates).toEqual(['aaa-gate', 'eslint-no-any'])
  })

  it('discovers FILE node via path-attr fallback loop (no exact id match)', () => {
    const dir = makeTmp()
    // Node id is NOT "FILE:src/bar.ts" but its path attr matches the changed file.
    writeGraph(
      dir,
      [
        { id: 'INV-09', kind: 'INV', attrs: {} },
        { id: 'GATE:g9', kind: 'GATE', attrs: {} },
        { id: 'node-xyz', kind: 'FILE', attrs: { path: 'src/bar.ts' } },
      ],
      [
        { from: 'INV-09', to: 'GATE:g9', kind: 'enforces', attrs: {} },
        { from: 'node-xyz', to: 'INV-09', kind: 'implements', attrs: {} },
      ],
    )
    const result = runCiPlan({ dir, changedFiles: ['src/bar.ts'] })
    expect(result.plan.impacted_invs).toContain('INV-09')
    expect(result.plan.required_gates).toContain('g9')
  })

  it('uses node.id (stripped of FILE: prefix) when path attr is absent', () => {
    const dir = makeTmp()
    // No exact "FILE:src/baz.ts" lookup hit because id is non-prefixed,
    // attrs.path is missing → nodePath derives from id via regex replace.
    writeGraph(
      dir,
      [
        { id: 'INV-10', kind: 'INV', attrs: {} },
        { id: 'GATE:g10', kind: 'GATE', attrs: {} },
        { id: 'FILE:src/baz.ts', kind: 'FILE', attrs: {} },
      ],
      [
        { from: 'INV-10', to: 'GATE:g10', kind: 'enforces', attrs: {} },
        { from: 'FILE:src/baz.ts', to: 'INV-10', kind: 'implements', attrs: {} },
      ],
    )
    // Exact "FILE:src/baz.ts" node exists, so the else (exact-hit) branch runs.
    const result = runCiPlan({ dir, changedFiles: ['src/baz.ts'] })
    expect(result.plan.impacted_invs).toContain('INV-10')
  })

  it('path-attr-missing FILE node matched via id-derived path (fallback loop)', () => {
    const dir = makeTmp()
    // Changed file id "FILE:lib/x.ts" present but we pass "lib/x.ts" which exact-hits.
    // To exercise the non-attr fallback path we give a node whose id is non-prefixed
    // AND whose path attr is missing → nodePath = node.id (no FILE: prefix to strip).
    writeGraph(
      dir,
      [
        { id: 'INV-11', kind: 'INV', attrs: {} },
        { id: 'GATE:g11', kind: 'GATE', attrs: {} },
        { id: 'lib/raw.ts', kind: 'FILE', attrs: {} },
      ],
      [
        { from: 'INV-11', to: 'GATE:g11', kind: 'enforces', attrs: {} },
        { from: 'lib/raw.ts', to: 'INV-11', kind: 'implements', attrs: {} },
      ],
    )
    const result = runCiPlan({ dir, changedFiles: ['lib/raw.ts'] })
    expect(result.plan.impacted_invs).toContain('INV-11')
  })

  it('collects INV via reverse incoming implements edge', () => {
    const dir = makeTmp()
    // Edge direction reversed: INV --implements--> FILE (incoming to the FILE node).
    writeGraph(
      dir,
      [
        { id: 'INV-20', kind: 'INV', attrs: {} },
        { id: 'FILE:src/rev.ts', kind: 'FILE', attrs: { path: 'src/rev.ts' } },
      ],
      [{ from: 'INV-20', to: 'FILE:src/rev.ts', kind: 'implements', attrs: {} }],
    )
    const result = runCiPlan({ dir, changedFiles: ['src/rev.ts'] })
    expect(result.plan.impacted_invs).toContain('INV-20')
  })

  it('ignores implements edges whose target/source is not an INV', () => {
    const dir = makeTmp()
    // FILE --implements--> SYMBOL (not INV) → target?.kind !== 'INV' guard.
    // SYMBOL --implements--> FILE (incoming, source not INV) → other guard.
    writeGraph(
      dir,
      [
        { id: 'FILE:src/g.ts', kind: 'FILE', attrs: { path: 'src/g.ts' } },
        { id: 'SYMBOL:foo', kind: 'SYMBOL', attrs: {} },
        { id: 'SYMBOL:bar', kind: 'SYMBOL', attrs: {} },
      ],
      [
        { from: 'FILE:src/g.ts', to: 'SYMBOL:foo', kind: 'implements', attrs: {} },
        { from: 'SYMBOL:bar', to: 'FILE:src/g.ts', kind: 'implements', attrs: {} },
      ],
    )
    const result = runCiPlan({ dir, changedFiles: ['src/g.ts'] })
    expect(result.plan.impacted_invs).toEqual([])
    expect(result.plan.required_gates).toEqual([])
  })

  it('changed file with no matching FILE node yields empty impact', () => {
    const dir = makeTmp()
    writeGraph(
      dir,
      [{ id: 'FILE:src/other.ts', kind: 'FILE', attrs: { path: 'src/other.ts' } }],
      [],
    )
    const result = runCiPlan({ dir, changedFiles: ['src/nonexistent.ts'] })
    expect(result.plan.impacted_invs).toEqual([])
  })

  it('catalog.ts touch fans out to all INVs and their gates', () => {
    const dir = makeTmp()
    writeGraph(
      dir,
      [
        { id: 'INV-01', kind: 'INV', attrs: {} },
        { id: 'INV-02', kind: 'INV', attrs: {} },
        { id: 'GATE:cat-gate', kind: 'GATE', attrs: {} },
      ],
      [{ from: 'INV-01', to: 'GATE:cat-gate', kind: 'enforces', attrs: {} }],
    )
    const result = runCiPlan({ dir, changedFiles: ['src/invariants/catalog.ts'] })
    expect(result.plan.impacted_invs).toEqual(['INV-01', 'INV-02'])
    expect(result.plan.required_gates).toContain('cat-gate')
  })

  it('AGENTS.md touch also triggers the catalog fan-out', () => {
    const dir = makeTmp()
    writeGraph(
      dir,
      [{ id: 'INV-77', kind: 'INV', attrs: {} }],
      [],
    )
    const result = runCiPlan({ dir, changedFiles: ['AGENTS.md'] })
    expect(result.plan.impacted_invs).toContain('INV-77')
  })

  it('emits impact mermaid when format=mermaid with a real graph', () => {
    const dir = makeTmp()
    writeGraph(
      dir,
      [
        { id: 'INV-04', kind: 'INV', attrs: {} },
        { id: 'GATE:eslint', kind: 'GATE', attrs: {} },
        { id: 'FILE:src/m.ts', kind: 'FILE', attrs: { path: 'src/m.ts' } },
      ],
      [
        { from: 'INV-04', to: 'GATE:eslint', kind: 'enforces', attrs: {} },
        { from: 'FILE:src/m.ts', to: 'INV-04', kind: 'implements', attrs: {} },
      ],
    )
    const result = runCiPlan({ dir, changedFiles: ['src/m.ts'], format: 'mermaid' })
    expect(result.mermaid).toBeDefined()
    const m = result.mermaid ?? ''
    expect(m).toContain('graph LR')
    expect(m).toContain('implements')
    expect(m).toContain('enforces')
    expect(m).toContain('FILE: src/m.ts')
    expect(m).toContain('INV-04')
    expect(m).toContain('GATE: eslint')
  })

  it('defaults changedFiles to [] when omitted (empty traversal)', () => {
    const dir = makeTmp()
    writeGraph(dir, [{ id: 'INV-01', kind: 'INV', attrs: {} }], [])
    const result = runCiPlan({ dir })
    expect(result.status).toBe('ok')
    expect(result.plan.fallback).toBe(false)
    expect(result.plan.impacted_invs).toEqual([])
  })
})

describe('runCiPlan — computeRiskClass branches (via plan.risk_class)', () => {
  function riskFor(files: string[]): string {
    const dir = makeTmp()
    writeGraph(dir, [], [])
    return runCiPlan({ dir, changedFiles: files }).plan.risk_class
  }

  it('R0 for migration directory', () => {
    expect(riskFor(['db/migrations/001_init.ts'])).toBe('R0')
  })

  it('R0 for .sql file', () => {
    expect(riskFor(['schema.sql'])).toBe('R0')
  })

  it('R1 for auth directory', () => {
    expect(riskFor(['src/auth/login.ts'])).toBe('R1')
  })

  it('R1 for payments directory', () => {
    expect(riskFor(['src/payments/charge.ts'])).toBe('R1')
  })

  it('R2 for api directory', () => {
    expect(riskFor(['api/users.ts'])).toBe('R2')
  })

  it('R2 for server directory', () => {
    expect(riskFor(['server/index.ts'])).toBe('R2')
  })

  it('R2 for a plain code file (.go)', () => {
    expect(riskFor(['pkg/handler.go'])).toBe('R2')
  })

  it('R3 for components directory', () => {
    expect(riskFor(['ui/components/Button.tsx'])).toBe('R3')
  })

  it('R4 for markdown / yaml / json docs', () => {
    expect(riskFor(['docs/README.md'])).toBe('R4')
    expect(riskFor(['config.yaml'])).toBe('R4')
  })

  it('R-unknown for an unclassifiable path', () => {
    expect(riskFor(['LICENSE'])).toBe('R-unknown')
  })

  it('picks the highest-risk class across multiple files', () => {
    // R4 (md) + R0 (sql) → highest risk is R0.
    expect(riskFor(['docs/x.md', 'migrations/y.sql'])).toBe('R0')
  })

  it('normalises backslash paths before matching', () => {
    expect(riskFor(['src\\auth\\token.ts'])).toBe('R1')
  })

  it('keeps the lower-index (higher) risk when a worse file comes later', () => {
    // First file R2 (.ts), second R1 (auth) → result must upgrade to R1.
    expect(riskFor(['src/util.ts', 'src/auth/guard.ts'])).toBe('R1')
  })
})

describe('runCiVerifyPlan — verify branches', () => {
  const realPlan = (gates: string[]): CiPlan => ({
    risk_class: 'R2',
    impacted_invs: ['INV-04'],
    required_gates: gates,
    fallback: false,
  })

  it('passes when all required gates are present', () => {
    const result = runCiVerifyPlan({
      plan: realPlan(['lint', 'unit']),
      ciResult: { gates: ['lint', 'unit', 'extra'] },
    })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
    expect(result.missingGates).toEqual([])
  })

  it('fails listing every missing gate in the reason string', () => {
    const result = runCiVerifyPlan({
      plan: realPlan(['lint', 'mutation', 'a11y']),
      ciResult: { gates: ['lint'] },
    })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(2)
    expect(result.missingGates).toEqual(['mutation', 'a11y'])
    expect(result.reason).toContain('mutation')
    expect(result.reason).toContain('a11y')
    expect(result.reason).toMatch(/2 required gate/)
  })

  it('passes immediately for a fallback plan, ignoring CI gates', () => {
    const result = runCiVerifyPlan({
      plan: {
        risk_class: 'R-unknown',
        impacted_invs: [],
        required_gates: ['would-fail-if-checked'],
        fallback: true,
      },
      ciResult: { gates: [] },
    })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
    expect(result.missingGates).toEqual([])
  })

  it('passes when a non-fallback plan requires no gates', () => {
    const result = runCiVerifyPlan({
      plan: realPlan([]),
      ciResult: { gates: [] },
    })
    expect(result.status).toBe('ok')
    expect(result.missingGates).toEqual([])
  })
})
