// SPDX-License-Identifier: Apache-2.0
// Branch-coverage climb for src/commands/conformance.ts (#1486).
//
// Targets the uncovered branches that the behavioural suite in
// __tests__/commands/conformance.test.ts does not reach:
//   - loadArbiterJson: arbiter.json parses to a non-object  → null → skip result
//   - readBaseline:    baseline parses to a non-object / lacks numeric score → null
//   - applyCheckRatchet: baseline present, score does NOT drop → ok
//   - applyUpdateBaseline: baseline present + score rises (write) / drops (fail)
//   - resolveGovernanceLevel: invalid/absent level string → 'L1' default
//   - computeDefaultResult: failOn==='partial' with P>0; strict with NV>0; shouldFail false
//   - runConformance: default dir branch (opts.dir absent → process.cwd())
//
// Pure file-IO command: no git/gh/spawn/process.exit seam exists. Every branch is
// exercised through a real mkdtempSync temp fixture, cleaned in afterEach.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { runConformance, baselineMtime } from '../../src/commands/conformance.js'

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const created: string[] = []

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'conformance-cov-'))
  created.push(dir)
  return dir
}

/** Write arbiter.json with arbitrary extra config keys. */
function writeArbiter(dir: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(
    join(dir, 'arbiter.json'),
    JSON.stringify({ version: '0.2', governanceLevel: 'L2', ...extra }, null, 2),
    'utf-8',
  )
}

/** Write the conformance baseline file with a chosen score. */
function writeBaseline(dir: string, payload: unknown): void {
  mkdirSync(join(dir, '.arbiter'), { recursive: true })
  writeFileSync(
    join(dir, '.arbiter', 'conformance-baseline.json'),
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    'utf-8',
  )
}

/**
 * Lay down every fixture file needed to make all 18 probes return Y or NA
 * (i.e. zero N verdicts) for a `frontend` archetype. The frontend archetype
 * makes D-LIVE-E2E → NA, and the FE render config makes D-FE-RENDER-GATE → Y.
 *
 * `readmeBody` lets the caller choose a full README (→ Y) or a short one (→ P)
 * so the partial-verdict count can be controlled without introducing any N.
 */
function writeAllPassFrontendFixture(dir: string, readmeBody: string): void {
  writeArbiter(dir, { archetype: 'frontend' })

  // D-TEST-LEVELS → Y: populated required level + a matching test file.
  mkdirSync(join(dir, '__tests__'), { recursive: true })
  writeFileSync(join(dir, '__tests__', 'sample.test.ts'), 'test("x", () => {})', 'utf-8')
  writeFileSync(
    join(dir, 'test-pyramid.json'),
    JSON.stringify({
      version: '1',
      levels: [{ level: 'unit', status: 'required', globs: ['**/*.test.ts'], rationale: '' }],
    }),
    'utf-8',
  )

  // D-FE-RENDER-GATE → Y: a render-smoke config file present.
  writeFileSync(join(dir, 'playwright.config.ts'), 'export default {}', 'utf-8')

  // D-DOMAIN-API → Y: non-empty checks array.
  writeFileSync(
    join(dir, 'domain-api-surface.json'),
    JSON.stringify({ checks: [{ id: 'CHK-01', type: 'file_exists', args: { path: 'README.md' } }] }),
    'utf-8',
  )

  // D-DONE-EVIDENCE → Y and D-NO-OVERCLAIM → Y: one evidence manifest serves both.
  mkdirSync(join(dir, '.claude'), { recursive: true })
  writeFileSync(
    join(dir, '.claude', '.last-done-evidence.json'),
    JSON.stringify({ reality_contact: { passed: true }, no_overclaim: true }),
    'utf-8',
  )

  // D-GATE-GREEN → Y (real arbiter-gate-v1 writer shape: boolean `pass`, no `overall`).
  mkdirSync(join(dir, '.arbiter', 'gate'), { recursive: true })
  writeFileSync(
    join(dir, '.arbiter', 'gate', 'local-result.json'),
    JSON.stringify({ schema: 'arbiter-gate-v1', level: 'L2', gates: [], pass: true }),
    'utf-8',
  )

  // D-COVERAGE-THRESHOLDS → Y: all metrics >= 80.
  mkdirSync(join(dir, 'coverage'), { recursive: true })
  writeFileSync(
    join(dir, 'coverage', 'coverage-summary.json'),
    JSON.stringify({
      total: {
        lines: { pct: 95 },
        branches: { pct: 90 },
        functions: { pct: 95 },
        statements: { pct: 95 },
      },
    }),
    'utf-8',
  )

  // D-INVARIANTS-ENFORCED → Y.
  writeFileSync(join(dir, '.arbiter', 'invariants.json'), JSON.stringify({ invariants: [] }), 'utf-8')

  // D-COMMIT-HYGIENE → Y: .husky/ + commitlint config.
  mkdirSync(join(dir, '.husky'), { recursive: true })
  writeFileSync(join(dir, '.husky', 'commit-msg'), '#!/bin/sh', 'utf-8')
  writeFileSync(
    join(dir, '.commitlintrc.json'),
    JSON.stringify({ extends: ['@commitlint/config-conventional'] }),
    'utf-8',
  )

  // DISC-finding-hygiene → NA (no findings spool created): non-N.

  // DOC-* probes.
  writeFileSync(join(dir, 'README.md'), readmeBody, 'utf-8')
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n', 'utf-8')
  mkdirSync(join(dir, 'docs', 'ADR'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'ADR', '0001-decision.md'), '# ADR 1\n', 'utf-8')
  writeFileSync(join(dir, 'CONTRIBUTING.md'), '# Contributing\n', 'utf-8')
  writeFileSync(join(dir, 'LICENSE'), 'Apache-2.0\n', 'utf-8')
  // DOC-API-DOCS and DOC-SECURITY intentionally absent → NV (non-N).
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('conformance.ts branch coverage (#1486)', () => {
  afterEach(() => {
    while (created.length > 0) {
      const dir = created.pop()
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    }
  })

  // ── loadArbiterJson: valid JSON but non-object → null → skip result ─────────
  it('treats a non-object arbiter.json (JSON string) as ungoverned (skip)', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify('not-an-object'), 'utf-8')

    const result = runConformance({ dir })
    expect(result.status).toBe('skip')
    expect(result.verdict).toBe('SKIP')
    expect(result.exitCode).toBe(0)
  })

  it('treats a JSON-number arbiter.json as ungoverned (skip)', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'arbiter.json'), '42', 'utf-8')

    const result = runConformance({ dir })
    expect(result.status).toBe('skip')
  })

  it('treats a JSON-null arbiter.json as ungoverned (skip)', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'arbiter.json'), 'null', 'utf-8')

    const result = runConformance({ dir })
    expect(result.status).toBe('skip')
  })

  it('treats a malformed (unparseable) arbiter.json as ungoverned (skip)', () => {
    const dir = tmpRepo()
    writeFileSync(join(dir, 'arbiter.json'), '{ this is : not json', 'utf-8')

    const result = runConformance({ dir })
    expect(result.status).toBe('skip')
  })

  // ── resolveGovernanceLevel: invalid level string → 'L1' default ────────────
  it('defaults to L1 when governanceLevel is an unrecognised string', () => {
    const dir = tmpRepo()
    writeArbiter(dir, { governanceLevel: 'L9' })

    // Just needs to run without throwing; the invalid level is silently coerced.
    const result = runConformance({ dir })
    expect(result.status).toBeDefined()
    expect(result.dimensions.length).toBeGreaterThan(0)
  })

  it('defaults to L1 when governanceLevel is a non-string (number)', () => {
    const dir = tmpRepo()
    writeArbiter(dir, { governanceLevel: 3 })

    const result = runConformance({ dir })
    expect(result.dimensions.length).toBeGreaterThan(0)
  })

  // ── readBaseline: non-object baseline → null → bootstrap path ───────────────
  it('--check rebootstraps when the baseline file is a non-object JSON', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    writeBaseline(dir, '"just-a-string"')

    const result = runConformance({ dir, check: true })
    // Non-object baseline parses to null → bootstrap branch → fresh write, exit 0.
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('ok')
    expect(baselineMtime(dir)).not.toBeNull()
  })

  it('--check rebootstraps when the baseline object lacks a numeric score', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    writeBaseline(dir, { score: 'high' })

    const result = runConformance({ dir, check: true })
    // score is non-number → readBaseline null → bootstrap → exit 0.
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('ok')
  })

  it('--check rebootstraps when the baseline file is unparseable', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    writeBaseline(dir, '{ broken json')

    const result = runConformance({ dir, check: true })
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('ok')
  })

  // ── applyCheckRatchet: baseline present, score does NOT drop → ok ──────────
  it('--check passes (exit 0) when the score is at or above the existing baseline', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    // A baseline of 0 can never be dropped below → exercises the no-drop branch.
    writeBaseline(dir, { score: 0 })

    const result = runConformance({ dir, check: true })
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('ok')
  })

  // ── applyUpdateBaseline: baseline present + score rises → write ────────────
  it('--update-baseline writes a higher score when it rises above the baseline', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    // First compute the real score, then plant a strictly-lower baseline.
    const first = runConformance({ dir })
    writeBaseline(dir, { score: Math.max(0, first.score - 10) })

    const result = runConformance({ dir, updateBaseline: true })
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('ok')
    expect(baselineMtime(dir)).not.toBeNull()
  })

  // ── applyUpdateBaseline: baseline present + score drops → fail ─────────────
  it('--update-baseline fails (exit 1) when the score drops below the baseline', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    // A perfect baseline guarantees the real score is lower → drop branch.
    writeBaseline(dir, { score: 100 })

    const result = runConformance({ dir, updateBaseline: true })
    expect(result.exitCode).toBe(1)
    expect(result.status).toBe('fail')
  })

  // ── applyUpdateBaseline: baseline present + score equal → no-op ────────────
  it('--update-baseline is a no-op (exit 0) when the score equals the baseline', () => {
    const dir = tmpRepo()
    writeArbiter(dir)
    // Plant a baseline at the exact current score → equal branch.
    const first = runConformance({ dir })
    writeBaseline(dir, { score: first.score })

    const result = runConformance({ dir, updateBaseline: true })
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('ok')
  })

  // ── applyUpdateBaseline: no baseline at all → write ────────────────────────
  it('--update-baseline writes a fresh baseline when none exists', () => {
    const dir = tmpRepo()
    writeArbiter(dir)

    const result = runConformance({ dir, updateBaseline: true })
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('ok')
    expect(baselineMtime(dir)).not.toBeNull()
  })

  // ── computeDefaultResult: failOn==='partial' with P>0 and zero N → fail ────
  it('failOn=partial exits 1 when a partial verdict exists and there are no fails', () => {
    const dir = tmpRepo()
    // Short README → DOC-README is P; every other probe is Y or NA → zero N.
    writeAllPassFrontendFixture(dir, 'tiny') // < 50 chars → partial

    const sanity = runConformance({ dir })
    expect(sanity.dimensions.filter((d) => d.verdict === 'N').length).toBe(0)
    expect(sanity.dimensions.filter((d) => d.verdict === 'P').length).toBeGreaterThan(0)
    // Default failOn=fail with no N → ok.
    expect(sanity.exitCode).toBe(0)

    const result = runConformance({ dir, failOn: 'partial' })
    expect(result.exitCode).toBe(1)
    expect(result.status).toBe('fail')
  })

  // ── computeDefaultResult: shouldFail===false (ok) over an all-Y/NA fixture ──
  it('exits 0 (ok) when every dimension is Y or NA/NV (no N, no partial)', () => {
    const dir = tmpRepo()
    // Full README (>= 50 chars) → DOC-README is Y, not P.
    writeAllPassFrontendFixture(dir, 'x'.repeat(80))

    const result = runConformance({ dir })
    expect(result.dimensions.filter((d) => d.verdict === 'N').length).toBe(0)
    expect(result.dimensions.filter((d) => d.verdict === 'P').length).toBe(0)
    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
  })

  // ── computeDefaultResult: strict && nv>0 → fail (evaluates the strict operand)
  it('strict exits 1 when NV dimensions exist even with zero N and zero partial', () => {
    const dir = tmpRepo()
    writeAllPassFrontendFixture(dir, 'x'.repeat(80))

    const sanity = runConformance({ dir })
    // DOC-API-DOCS and DOC-SECURITY are absent → NV.
    expect(sanity.dimensions.filter((d) => d.verdict === 'NV').length).toBeGreaterThan(0)

    const result = runConformance({ dir, strict: true })
    expect(result.exitCode).toBe(1)
    expect(result.status).toBe('fail')
  })

  it('strict passes (exit 0) when there are no NV dimensions', () => {
    const dir = tmpRepo()
    writeAllPassFrontendFixture(dir, 'x'.repeat(80))
    // Add SECURITY.md and a docs/API entry to flip the two NV doc probes to Y.
    writeFileSync(join(dir, 'SECURITY.md'), '# Security Policy\n', 'utf-8')
    mkdirSync(join(dir, 'docs', 'API'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'API', 'index.md'), '# API\n', 'utf-8')

    const sanity = runConformance({ dir })
    expect(sanity.dimensions.filter((d) => d.verdict === 'NV').length).toBe(0)
    expect(sanity.dimensions.filter((d) => d.verdict === 'N').length).toBe(0)

    const result = runConformance({ dir, strict: true })
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('ok')
  })

  // ── runConformance: default dir branch (opts.dir absent → process.cwd()) ────
  it('uses process.cwd() when no dir option is supplied', () => {
    const dir = tmpRepo()
    const original = process.cwd()
    try {
      process.chdir(dir) // empty temp dir → ungoverned → fast skip, no repo walk
      const result = runConformance() // no opts at all → opts.dir undefined
      expect(result.status).toBe('skip')
      expect(result.exitCode).toBe(0)
    } finally {
      process.chdir(original)
    }
  })

  // ── baselineMtime: catch branch when the baseline file is absent ───────────
  it('baselineMtime returns null when the baseline file does not exist', () => {
    const dir = tmpRepo() // empty temp dir, no .arbiter/conformance-baseline.json
    expect(baselineMtime(dir)).toBeNull()
  })

  it('baselineMtime returns a number once the baseline file exists', () => {
    const dir = tmpRepo()
    writeBaseline(dir, { score: 42 })
    const mtime = baselineMtime(dir)
    expect(mtime).not.toBeNull()
    expect(typeof mtime).toBe('number')
  })

  // ── runConformance: archetype is a non-string → archetype coerced to null ───
  it('handles a non-string archetype as null (no service/FE classification)', () => {
    const dir = tmpRepo()
    writeArbiter(dir, { archetype: 123 })

    const result = runConformance({ dir })
    // archetype null → D-LIVE-E2E NA and D-FE-RENDER-GATE NA.
    const live = result.dimensions.find((d) => d.id === 'D-LIVE-E2E')
    const fe = result.dimensions.find((d) => d.id === 'D-FE-RENDER-GATE')
    expect(live?.verdict).toBe('NA')
    expect(fe?.verdict).toBe('NA')
  })
})
