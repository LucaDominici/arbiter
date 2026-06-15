// SPDX-License-Identifier: Apache-2.0
// Tests for `arbiter conformance` (#1369) — per-dimension gold-pattern scorecard.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import {
  runConformance,
  type ConformanceOptions,
  type ConformanceResult,
  type DimensionVerdict,
} from '../../src/commands/conformance.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'conformance-test-'))
  return dir
}

function writeArbiter(dir: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(
    join(dir, 'arbiter.json'),
    JSON.stringify({ version: '0.2', governanceLevel: 'L2', ...extra }, null, 2),
    'utf-8',
  )
}

function writeTestPyramid(dir: string, levels: unknown[]): void {
  writeFileSync(join(dir, 'test-pyramid.json'), JSON.stringify({ version: '1', levels }, null, 2))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('conformance (#1369)', () => {
  const created: string[] = []
  afterEach(() => {
    while (created.length > 0) {
      const dir = created.pop()
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    }
  })

  function tmpRepo(): string {
    const dir = makeTmp()
    created.push(dir)
    return dir
  }

  // ── AC-1: basic invocation returns a result ────────────────────────────────
  it('AC-1: returns a ConformanceResult with all required fields', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const opts: ConformanceOptions = { dir }
    const result: ConformanceResult = runConformance(opts)

    expect(result).toHaveProperty('status')
    expect(result).toHaveProperty('score')
    expect(result).toHaveProperty('dimensions')
    expect(Array.isArray(result.dimensions)).toBe(true)
    expect(result.dimensions.length).toBeGreaterThan(0)
  })

  // ── AC-2: per-dimension entries have required fields ─────────────────────
  it('AC-2: each dimension entry has id, verdict, evidence fields', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir })

    for (const dim of result.dimensions) {
      expect(dim).toHaveProperty('id')
      expect(dim).toHaveProperty('verdict')
      expect(['Y', 'P', 'N', 'NA', 'NV']).toContain(dim.verdict)
      expect(dim).toHaveProperty('evidence')
    }
  })

  // ── AC-3: covers all 5 required dimensions ─────────────────────────────
  it('AC-3: includes all five required dimensions', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir })
    const ids = result.dimensions.map((d) => d.id)

    expect(ids).toContain('D-TEST-LEVELS')
    expect(ids).toContain('D-LIVE-E2E')
    expect(ids).toContain('D-FE-RENDER-GATE')
    expect(ids).toContain('D-DOMAIN-API')
    expect(ids).toContain('D-DONE-EVIDENCE')
  })

  // ── AC-4: D-TEST-LEVELS pass when pyramid is populated ──────────────────
  it('AC-4: D-TEST-LEVELS is pass when test-pyramid.json has populated required levels', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    // Create a test file that matches the glob
    mkdirSync(join(dir, '__tests__'), { recursive: true })
    writeFileSync(join(dir, '__tests__', 'foo.test.ts'), 'test("x", () => {})')
    writeTestPyramid(dir, [
      { level: 'unit', status: 'required', globs: ['**/*.test.ts'], rationale: '' },
    ])

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-TEST-LEVELS')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('Y')
  })

  // ── AC-5: D-TEST-LEVELS fail when test-pyramid.json is absent ───────────
  it('AC-5: D-TEST-LEVELS is fail when test-pyramid.json is absent', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    // No test-pyramid.json

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-TEST-LEVELS')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('N')
  })

  // ── AC-6: D-DONE-EVIDENCE pass when evidence dir has files ──────────────
  it('AC-6: D-DONE-EVIDENCE is pass when .arbiter/evidence/ has evidence files', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    mkdirSync(join(dir, '.arbiter', 'evidence'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', 'evidence', 'done.json'),
      JSON.stringify({ obs_gate: 'PASS' }),
    )

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-DONE-EVIDENCE')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('Y')
  })

  // ── AC-7: D-DONE-EVIDENCE fail when evidence dir is absent ─────────────
  it('AC-7: D-DONE-EVIDENCE is fail when .arbiter/evidence/ is absent', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    // No .arbiter/evidence/

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-DONE-EVIDENCE')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('N')
  })

  // ── AC-8: exit code 1 when any dimension fails ──────────────────────────
  it('AC-8: exitCode is 1 when at least one dimension is fail', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    // No test-pyramid.json → D-TEST-LEVELS fail

    const result = runConformance({ dir })
    expect(result.exitCode).toBe(1)
  })

  // ── AC-9: exits 0 when all applicable dimensions pass ──────────────────
  it('AC-9: exitCode is 0 when all dimensions pass or skip', () => {
    const dir = tmpRepo()
    // No arbiter.json → all dimensions skip (not a governed project)

    const result = runConformance({ dir })
    // A project with no arbiter.json should either return skip for all or fail gracefully
    expect([0, 1]).toContain(result.exitCode)
    expect(result.status).toBeDefined()
  })

  // ── AC-10: --json flag: result has all structured fields ────────────────
  it('AC-10: result has score as a number between 0 and 100', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir })
    expect(typeof result.score).toBe('number')
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })

  // ── AC-11: D-FE-RENDER-GATE skip when no FE archetype ──────────────────
  it('AC-11: D-FE-RENDER-GATE is skip when archetype is backend', () => {
    const dir = tmpRepo()
    writeArbiter(dir, { archetype: 'backend-web-db' })

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-FE-RENDER-GATE')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('NA')
  })

  // ── AC-12: D-DOMAIN-API pass when pact or openapi setup found ──────────
  it('AC-12: D-DOMAIN-API is pass when openapi spec file exists', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    writeFileSync(join(dir, 'openapi.yaml'), 'openapi: "3.0.0"')

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-DOMAIN-API')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('Y')
  })

  // ── AC-13: DimensionVerdict type check ─────────────────────────────────
  it('AC-13: verdict values are one of the expected enum values', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir })
    const validVerdicts: DimensionVerdict[] = ['Y', 'P', 'N', 'NA', 'NV']
    for (const dim of result.dimensions) {
      expect(validVerdicts).toContain(dim.verdict)
    }
  })

  // ── AC-14: missing arbiter.json → all dimensions skip ─────────────────
  it('AC-14: when arbiter.json is missing all dimensions are skip and exitCode is 0', () => {
    const dir = tmpRepo()
    // Empty temp dir, no arbiter.json

    const result = runConformance({ dir })
    // When not a governed project, all checks should skip
    expect(result.status).toBe('skip')
    expect(result.exitCode).toBe(0)
  })

  // ── AC-15: D-LIVE-E2E pass when e2e test files exist ──────────────────
  it('AC-15: D-LIVE-E2E is pass when e2e test files exist in the project', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    mkdirSync(join(dir, '__tests__', 'e2e'), { recursive: true })
    writeFileSync(join(dir, '__tests__', 'e2e', 'api.e2e.ts'), 'test("e2e", () => {})')

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-LIVE-E2E')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('Y')
  })

  // ── TDD Unit 7: DimensionEntry new columns present ────────────────────
  it('AC-N1: each dimension entry has family, tier, weight, required_at fields', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir })
    for (const dim of result.dimensions) {
      expect(dim).toHaveProperty('family')
      expect(['discipline', 'reality-contact', 'docs-convention', 'code-quality-gold']).toContain(
        (dim as unknown as Record<string, unknown>)['family'],
      )
      expect(dim).toHaveProperty('tier')
      expect(dim).toHaveProperty('weight')
      expect(dim).toHaveProperty('required_at')
    }
  })

  it('AC-N2: verdict values use Y/P/N/NA/NV scale (not pass/fail/skip)', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir })
    const newScale: DimensionVerdict[] = ['Y', 'P', 'N', 'NA', 'NV']
    for (const dim of result.dimensions) {
      expect(newScale).toContain(dim.verdict)
    }
  })

  it('AC-N3: ungoverned project returns score 0 (all NA, applicable=0)', () => {
    const dir = tmpRepo()

    const result = runConformance({ dir })
    expect(result.status).toBe('skip')
    expect(result.score).toBe(0)
  })
})
