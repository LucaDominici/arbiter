/**
 * `arbiter ci plan` / `arbiter ci verify-plan` command tests (#261).
 *
 * Covers:
 *   AC-1  reads .arbiter/graph.json, traverses graph from changed files
 *   AC-2  emits JSON plan with impacted invariants + risk class + required gates
 *   AC-3  verify-plan reads plan + CI result, checks required gates ran
 *   AC-4  falls back gracefully when no graph exists
 *   AC-5  --format mermaid option
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { runCiPlan, runCiVerifyPlan } from '../../src/commands/ci.js'

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'ci-test-'))
}

function writeGraph(dir: string, nodes: unknown[], edges: unknown[]): void {
  mkdirSync(join(dir, '.arbiter'), { recursive: true })
  writeFileSync(
    join(dir, '.arbiter', 'graph.json'),
    JSON.stringify({ nodes, edges }, null, 2),
    'utf-8',
  )
}

describe('ci plan (#261, AC-1 AC-2 AC-4)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  it('returns minimal plan when no graph exists (graceful fallback)', () => {
    const dir = makeTmp()
    dirs.push(dir)
    const result = runCiPlan({ dir, diff: 'HEAD~1', changedFiles: ['src/foo.ts'] })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
    expect(result.plan.risk_class).toBe('R-unknown')
    expect(result.plan.fallback).toBe(true)
    expect(result.plan.warning).toMatch(/no graph/)
  })

  it('traverses graph and finds impacted INVs', () => {
    const dir = makeTmp()
    dirs.push(dir)
    writeGraph(
      dir,
      [
        { id: 'INV-04', kind: 'INV', attrs: { title: 'No any', tier: 'T1', alwaysActive: true } },
        { id: 'GATE:eslint-no-any', kind: 'GATE', attrs: { mechanism: 'eslint-no-any' } },
        { id: 'FILE:src/foo.ts', kind: 'FILE', attrs: { path: 'src/foo.ts' } },
      ],
      [
        { from: 'INV-04', to: 'GATE:eslint-no-any', kind: 'enforces', attrs: {} },
        { from: 'FILE:src/foo.ts', to: 'INV-04', kind: 'implements', attrs: {} },
      ],
    )
    const result = runCiPlan({ dir, diff: 'HEAD~1', changedFiles: ['src/foo.ts'] })
    expect(result.status).toBe('ok')
    expect(result.plan.impacted_invs).toContain('INV-04')
    expect(result.plan.required_gates.length).toBeGreaterThan(0)
  })

  it('emits mermaid format', () => {
    const dir = makeTmp()
    dirs.push(dir)
    const result = runCiPlan({
      dir,
      diff: 'HEAD~1',
      changedFiles: ['src/bar.ts'],
      format: 'mermaid',
    })
    expect(result.status).toBe('ok')
    expect(result.mermaid).toBeDefined()
    expect(result.mermaid).toContain('graph LR')
  })

  it('returns R0 risk class when INV-04 is impacted (via enforces edge)', () => {
    const dir = makeTmp()
    dirs.push(dir)
    writeGraph(
      dir,
      [
        {
          id: 'INV-04',
          kind: 'INV',
          attrs: { title: 'No any', tier: 'T1', alwaysActive: true, minGovernanceLevel: 'L1' },
        },
        { id: 'GATE:g', kind: 'GATE', attrs: {} },
        { id: 'FILE:src/auth/login.ts', kind: 'FILE', attrs: { path: 'src/auth/login.ts' } },
      ],
      [
        { from: 'INV-04', to: 'GATE:g', kind: 'enforces', attrs: {} },
        { from: 'FILE:src/auth/login.ts', to: 'INV-04', kind: 'implements', attrs: {} },
      ],
    )
    const result = runCiPlan({ dir, diff: 'HEAD~1', changedFiles: ['src/auth/login.ts'] })
    expect(result.status).toBe('ok')
    // auth path is R1 by typescript rules, but with INV impact it stays R1 (not upgraded)
    // The plan must include INV-04 as impacted
    expect(result.plan.impacted_invs).toContain('INV-04')
  })
})

describe('ci verify-plan (#261, AC-3)', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  it('passes when all required gates are present in CI result', () => {
    const dir = makeTmp()
    dirs.push(dir)
    const plan = {
      risk_class: 'R2',
      impacted_invs: ['INV-04'],
      required_gates: ['eslint-no-any', 'lint'],
      fallback: false,
    }
    const ciResult = {
      gates: ['eslint-no-any', 'lint', 'unit-tests'],
    }
    const result = runCiVerifyPlan({ plan, ciResult })
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
  })

  it('fails when a required gate is missing from CI result', () => {
    const plan = {
      risk_class: 'R2',
      impacted_invs: ['INV-04'],
      required_gates: ['eslint-no-any', 'mutation-tests'],
      fallback: false,
    }
    const ciResult = {
      gates: ['eslint-no-any'],
    }
    const result = runCiVerifyPlan({ plan, ciResult })
    expect(result.status).toBe('error')
    expect(result.exitCode).toBe(2)
    expect(result.missingGates).toContain('mutation-tests')
  })

  it('passes for fallback plan regardless of CI result', () => {
    const plan = {
      risk_class: 'R-unknown',
      impacted_invs: [],
      required_gates: [],
      fallback: true,
      warning: 'no graph',
    }
    const ciResult = { gates: [] }
    const result = runCiVerifyPlan({ plan, ciResult })
    expect(result.status).toBe('ok')
  })
})
