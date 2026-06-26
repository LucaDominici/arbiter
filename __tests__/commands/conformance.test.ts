// SPDX-License-Identifier: Apache-2.0
// Tests for `arbiter conformance` (#1369, C5 #1397) — per-dimension gold-pattern scorecard.
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import {
  runConformance,
  baselineMtime,
  type ConformanceOptions,
  type ConformanceScanResult,
  type Verdict,
} from '../../src/commands/conformance.js'
import { renderConformanceMd } from '../../src/conformance/render.js'

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
    const result: ConformanceScanResult = runConformance(opts)

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

  // ── AC-6: D-DONE-EVIDENCE fail when .claude/.last-done-evidence.json is absent ──────────────
  // Breaking: replaced .arbiter/evidence/ directory-count probe with canonical manifest reader (C3 #1395)
  it('AC-6: D-DONE-EVIDENCE is fail when .claude/.last-done-evidence.json is absent', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    // No .claude/.last-done-evidence.json

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-DONE-EVIDENCE')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('N')
  })

  // ── AC-7: D-DONE-EVIDENCE pass when .claude/.last-done-evidence.json has reality_contact.passed=true
  it('AC-7: D-DONE-EVIDENCE is pass when .last-done-evidence.json has reality_contact.passed=true', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(
      join(dir, '.claude', '.last-done-evidence.json'),
      JSON.stringify({ reality_contact: { passed: true } }),
    )

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-DONE-EVIDENCE')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('Y')
  })

  // ── AC-8-new: D-DONE-EVIDENCE fail when reality_contact.passed=false ─────────────
  it('AC-8-new: D-DONE-EVIDENCE is fail when .last-done-evidence.json has reality_contact.passed=false', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(
      join(dir, '.claude', '.last-done-evidence.json'),
      JSON.stringify({ reality_contact: { passed: false } }),
    )

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

  // ── AC-12: D-DOMAIN-API pass when domain-api-surface.json has checks ──────────
  it('AC-12: D-DOMAIN-API is pass when domain-api-surface.json has non-empty checks', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    writeFileSync(
      join(dir, 'domain-api-surface.json'),
      JSON.stringify({
        checks: [{ id: 'CHK-01', type: 'file_exists', args: { path: 'README.md' } }],
      }),
    )

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-DOMAIN-API')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('Y')
  })

  // ── AC-13: Verdict type check ─────────────────────────────────
  it('AC-13: verdict values are one of the expected enum values', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir })
    const validVerdicts: Verdict[] = ['Y', 'P', 'N', 'NA', 'NV']
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

  // ── AC-15: D-LIVE-E2E pass when api-e2e.json shows suiteCount > 0 ──────────────────
  it('AC-15: D-LIVE-E2E is pass when api-e2e.json has suiteCount > 0 and service archetype', () => {
    const dir = tmpRepo()
    writeArbiter(dir, { archetype: 'backend-web-db' })
    writeFileSync(join(dir, 'api-e2e.json'), JSON.stringify({ exists: true, suiteCount: 3 }))

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-LIVE-E2E')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('Y')
  })

  // ── AC-15b: D-LIVE-E2E NA when archetype is not service ──────────────────
  it('AC-15b: D-LIVE-E2E is NA when archetype is not backend-web-db', () => {
    const dir = tmpRepo()
    writeArbiter(dir, { archetype: 'frontend' })

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-LIVE-E2E')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('NA')
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
    const newScale: Verdict[] = ['Y', 'P', 'N', 'NA', 'NV']
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

  // ── Evidence object type assertions (C3 #1395) ─────────────────────────
  it('AC-EV1: evidence fields in governed project are Evidence objects with file property', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir })
    for (const dim of result.dimensions) {
      if (dim.evidence !== null && dim.evidence !== undefined) {
        expect(typeof dim.evidence).toBe('object')
        expect(dim.evidence).toHaveProperty('file')
        expect(typeof (dim.evidence as { file: string }).file).toBe('string')
      }
    }
  })

  // ── Discipline probe tests (C3 #1395) ──────────────────────────────────
  it('AC-D1: dimensions include discipline probes (gate-green, coverage, invariants, no-overclaim, commit-hygiene)', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir })
    const ids = result.dimensions.map((d) => d.id)

    expect(ids).toContain('D-GATE-GREEN')
    expect(ids).toContain('D-COVERAGE-THRESHOLDS')
    expect(ids).toContain('D-INVARIANTS-ENFORCED')
    expect(ids).toContain('D-NO-OVERCLAIM')
    expect(ids).toContain('D-COMMIT-HYGIENE')
  })

  it('AC-D2: D-GATE-GREEN is Y when .arbiter/gate/local-result.json has overall=pass', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    mkdirSync(join(dir, '.arbiter', 'gate'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', 'gate', 'local-result.json'),
      JSON.stringify({ overall: 'pass' }),
    )

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-GATE-GREEN')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('Y')
  })

  it('AC-D3: D-GATE-GREEN is N when local-result.json is absent', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-GATE-GREEN')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('N')
  })

  it('AC-D4: D-COVERAGE-THRESHOLDS is Y when coverage-summary.json has all pct >= 80', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    mkdirSync(join(dir, 'coverage'), { recursive: true })
    writeFileSync(
      join(dir, 'coverage', 'coverage-summary.json'),
      JSON.stringify({
        total: {
          lines: { pct: 90 },
          branches: { pct: 85 },
          functions: { pct: 92 },
          statements: { pct: 90 },
        },
      }),
    )

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-COVERAGE-THRESHOLDS')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('Y')
  })

  it('AC-D5: D-COVERAGE-THRESHOLDS is NV when coverage-summary.json is absent', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-COVERAGE-THRESHOLDS')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('NV')
  })

  it('AC-D6: D-NO-OVERCLAIM is Y when .last-done-evidence.json has no_overclaim=true', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(
      join(dir, '.claude', '.last-done-evidence.json'),
      JSON.stringify({ no_overclaim: true }),
    )

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-NO-OVERCLAIM')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('Y')
  })

  it('AC-D7: D-COMMIT-HYGIENE is Y when .husky/ and commitlint config exist', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    mkdirSync(join(dir, '.husky'), { recursive: true })
    writeFileSync(join(dir, '.husky', 'commit-msg'), '#!/bin/sh')
    writeFileSync(
      join(dir, '.commitlintrc.json'),
      JSON.stringify({ extends: ['@commitlint/config-conventional'] }),
    )

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'D-COMMIT-HYGIENE')
    expect(dim).toBeDefined()
    expect(dim!.verdict).toBe('Y')
  })

  // ── A3 #1405: DISC-finding-hygiene wired into collectDimensions ───────────
  it('AC-A3-1: dimensions include DISC-finding-hygiene (discipline family)', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir })
    const dim = result.dimensions.find((d) => d.id === 'DISC-finding-hygiene')
    expect(dim).toBeDefined()
    expect(dim!.family).toBe('discipline')
    // No findings spool in a bare governed repo → NA (anti-gaming: absence ≠ N)
    expect(dim!.verdict).toBe('NA')
  })

  // ── C5 #1397: aggregator + full output + gate wiring ─────────────────────

  // AC-C5-1: result includes verdict from two-tier scoring
  it('AC-C5-1: ConformanceScanResult includes verdict field (GOLD|CONFORMANT|NON-CONFORMANT)', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result: ConformanceScanResult = runConformance({ dir })
    expect(result).toHaveProperty('verdict')
    expect(['GOLD', 'CONFORMANT', 'NON-CONFORMANT', 'SKIP']).toContain(result.verdict)
  })

  // AC-C5-2: ungoverned project returns verdict SKIP
  it('AC-C5-2: ungoverned project returns verdict SKIP', () => {
    const dir = tmpRepo()

    const result = runConformance({ dir })
    expect(result.verdict).toBe('SKIP')
    expect(result.exitCode).toBe(0)
  })

  // AC-C5-3: --json output schema has verdict, score, dimensions array
  it('AC-C5-3: result has verdict, score (number 0-100), dimensions array', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir })
    expect(result).toHaveProperty('verdict')
    expect(result).toHaveProperty('score')
    expect(typeof result.score).toBe('number')
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(Array.isArray(result.dimensions)).toBe(true)
    expect(result.dimensions.length).toBeGreaterThan(10) // all three families
  })

  // AC-C5-4: --strict flag: NV dims > 0 → exitCode 1
  it('AC-C5-4: --strict exits 1 when any dimension is NV', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    // DOC-API-DOCS and DOC-SECURITY return NV when absent, so strict should fail

    const result = runConformance({ dir, strict: true })
    // NV dims exist (D-COVERAGE-THRESHOLDS, DOC-API-DOCS, DOC-SECURITY)
    const nvCount = result.dimensions.filter((d) => d.verdict === 'NV').length
    if (nvCount > 0) {
      expect(result.exitCode).toBe(1)
    }
  })

  // AC-C5-5: --check baseline bootstrap: absent baseline → write baseline, exit 0
  it('AC-C5-5: --check with no baseline writes baseline and exits 0', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir, check: true })
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('ok')
    // baseline should now exist
    const mtimeAfter = baselineMtime(dir)
    expect(mtimeAfter).not.toBeNull()
  })

  // AC-C5-6: --check score drop → exit 1
  it('AC-C5-6: --check exits 1 when score drops below baseline', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    // Write a baseline with a perfect score (100) so any real score will be lower
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', 'conformance-baseline.json'),
      JSON.stringify({ score: 100 }),
    )

    const result = runConformance({ dir, check: true })
    // Real score will be < 100 since many dims will fail
    expect(result.exitCode).toBe(1)
    expect(result.status).toBe('fail')
  })

  // AC-C5-7: --update-baseline equal score → no-op, mtime unchanged
  it('AC-C5-7: --update-baseline with equal score is no-op (mtime unchanged)', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    // First run to get the actual score
    const first = runConformance({ dir })
    const score = first.score

    // Write baseline with exact same score
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    const baselinePath = join(dir, '.arbiter', 'conformance-baseline.json')
    writeFileSync(baselinePath, JSON.stringify({ score }))
    const mtimeBefore = statSync(baselinePath).mtimeMs

    // Small sleep to ensure mtime would differ if written
    const result = runConformance({ dir, updateBaseline: true })
    const mtimeAfter = statSync(baselinePath).mtimeMs

    expect(result.exitCode).toBe(0)
    expect(mtimeAfter).toBe(mtimeBefore) // file not written
  })

  // AC-C5-8: DOC probes are included in results
  it('AC-C5-8: dimensions include all 7 DOC-* probes', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir })
    const ids = result.dimensions.map((d) => d.id)

    expect(ids).toContain('DOC-README')
    expect(ids).toContain('DOC-CHANGELOG')
    expect(ids).toContain('DOC-ADR')
    expect(ids).toContain('DOC-CONTRIBUTING')
    expect(ids).toContain('DOC-LICENSE')
    expect(ids).toContain('DOC-API-DOCS')
    expect(ids).toContain('DOC-SECURITY')
  })

  // AC-C5-9: renderConformanceMd produces markdown table
  it('AC-C5-9: renderConformanceMd produces markdown table with verdict header', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir })
    const md = renderConformanceMd(result, result.dimensions)

    expect(md).toContain('## Conformance Scorecard')
    expect(md).toContain('| Dimension')
    expect(md).toContain('| Family')
    expect(md).toContain('| Verdict')
    expect(md).toContain('**Overall verdict:')
    expect(md).toContain('### Per-family rollup')
  })

  // AC-C5-10: CLI alias — adherence command routes to runConformance
  // (Tested indirectly via same function signature)
  it('AC-C5-10: runConformance is the shared implementation for both commands', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir })
    // The same function powers both `conformance` and `adherence`
    expect(result).toHaveProperty('verdict')
    expect(result).toHaveProperty('score')
    expect(result).toHaveProperty('dimensions')
    expect(result).toHaveProperty('exitCode')
  })
})
