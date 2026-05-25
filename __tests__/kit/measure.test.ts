// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { measureDim, type MeasureResult } from '../../src/kit/measure.js'
import type { KitDimension } from '../../src/kit/schema.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDim(overrides: Partial<KitDimension> = {}): KitDimension {
  return {
    id: 'N01',
    name: 'Test dim',
    tml: 'M',
    gate: 'L1',
    categoryRef: 'testing',
    archetypeGating: { applies: [], excludes: [] },
    status: 'covered',
    ...overrides,
  }
}

// ─── Fixture repo ─────────────────────────────────────────────────────────────

let fixtureRoot: string

beforeAll(() => {
  fixtureRoot = join(tmpdir(), `arbiter-measure-test-${process.pid}`)
  mkdirSync(fixtureRoot, { recursive: true })

  // Create representative files that dims check for
  mkdirSync(join(fixtureRoot, '.github/workflows'), { recursive: true })
  mkdirSync(join(fixtureRoot, 'src'), { recursive: true })
  mkdirSync(join(fixtureRoot, '__tests__'), { recursive: true })
  mkdirSync(join(fixtureRoot, 'scripts'), { recursive: true })

  writeFileSync(join(fixtureRoot, 'package.json'), JSON.stringify({ name: 'test-project' }))
  writeFileSync(join(fixtureRoot, '.github/workflows/01-gate.yml'), 'name: gate')
  writeFileSync(join(fixtureRoot, 'AGENTS.md'), '# Agents')
})

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

// ─── Return type ──────────────────────────────────────────────────────────────

describe('measureDim — return type', () => {
  it('returns MeasureResult with status and evidence', () => {
    const dim = makeDim()
    const result: MeasureResult = measureDim(dim, fixtureRoot)
    expect(result).toHaveProperty('status')
    expect(result).toHaveProperty('evidence')
    expect(Array.isArray(result.evidence)).toBe(true)
  })

  it('status is one of present|partial|missing', () => {
    const dim = makeDim()
    const result = measureDim(dim, fixtureRoot)
    expect(['present', 'partial', 'missing']).toContain(result.status)
  })
})

// ─── Evidence determinism ─────────────────────────────────────────────────────

describe('measureDim — evidence determinism', () => {
  it('produces lexicographically sorted evidence paths', () => {
    const dim = makeDim()
    const result = measureDim(dim, fixtureRoot)
    const sorted = [...result.evidence].sort()
    expect(result.evidence).toEqual(sorted)
  })

  it('produces identical output on repeated calls', () => {
    const dim = makeDim()
    const r1 = measureDim(dim, fixtureRoot)
    const r2 = measureDim(dim, fixtureRoot)
    expect(r1.status).toBe(r2.status)
    expect(r1.evidence).toEqual(r2.evidence)
  })

  it('evidence paths use forward slashes (POSIX-relative)', () => {
    const dim = makeDim()
    const result = measureDim(dim, fixtureRoot)
    for (const e of result.evidence) {
      expect(e).not.toMatch(/^\//)
      expect(e).not.toContain('\\')
    }
  })

  it('evidence paths have no duplicates', () => {
    const dim = makeDim()
    const result = measureDim(dim, fixtureRoot)
    const unique = new Set(result.evidence)
    expect(result.evidence.length).toBe(unique.size)
  })
})

// ─── Empty repo (everything missing) ─────────────────────────────────────────

describe('measureDim — empty repo', () => {
  let emptyRoot: string

  beforeAll(() => {
    emptyRoot = join(tmpdir(), `arbiter-measure-empty-${process.pid}`)
    mkdirSync(emptyRoot, { recursive: true })
    writeFileSync(join(emptyRoot, 'package.json'), '{}')
  })

  afterAll(() => {
    rmSync(emptyRoot, { recursive: true, force: true })
  })

  it('returns missing for dim requiring workflow files in empty repo', () => {
    const dim = makeDim({ id: 'N20', categoryRef: 'cicd', status: 'missing' })
    const result = measureDim(dim, emptyRoot)
    expect(result.status).toBe('missing')
    expect(result.evidence).toHaveLength(0)
  })
})

// ─── Repo with gate workflow ──────────────────────────────────────────────────

describe('measureDim — repo with CI/CD files', () => {
  it('returns present or partial for CI-related dim when workflow file exists', () => {
    // N20 is a CI dim — .github/workflows/*.yml exists in fixtureRoot
    const dim = makeDim({ id: 'N20', categoryRef: 'cicd', status: 'covered' })
    const result = measureDim(dim, fixtureRoot)
    expect(['present', 'partial']).toContain(result.status)
  })
})

// ─── Non-existent repoRoot ────────────────────────────────────────────────────

describe('measureDim — missing repoRoot', () => {
  it('returns missing without throwing', () => {
    const dim = makeDim()
    const result = measureDim(dim, '/tmp/does-not-exist-arbiter-test')
    expect(result.status).toBe('missing')
    expect(result.evidence).toHaveLength(0)
  })
})
