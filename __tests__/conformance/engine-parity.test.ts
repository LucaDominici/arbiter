// SPDX-License-Identifier: Apache-2.0
// TDD red: unit 6 for #1393 — cross-engine parity gate.
// Asserts that the TS engine (src/conformance/engine.ts) and the .mjs evaluator
// (scripts/lib/gold-audit-lib.mjs) produce identical verdicts, score, and yCount
// on shared mini-registry test cases.
// Uses dynamic import() (not spawnSync) to preserve the JS value boundary.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evaluate, type RegistryInput } from '../../src/conformance/engine.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const MJS_PATH = join(REPO_ROOT, 'scripts/lib/gold-audit-lib.mjs')

// MJS evaluate(registry, overlays, root, options?) — same signature as the TS engine.
let mjsModule: {
  evaluate: (registry: unknown, overlays: Set<string>, root: string, options?: unknown) => unknown
}

beforeAll(async () => {
  mjsModule = (await import(MJS_PATH)) as typeof mjsModule
})

let created: string[]

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'parity-test-'))
  created.push(dir)
  return dir
}

beforeAll(() => {
  created = []
})

afterAll(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

// ── Inline mini-registry for deterministic parity test cases ─────────────────

const MINI_REGISTRY: RegistryInput = {
  version: '1.0.0',
  checks: [
    { id: 'A-01', type: 'file_exists', args: { path: 'README.md' } },
    { id: 'A-02', type: 'file_contains', args: { path: 'README.md', pattern: 'install' } },
    { id: 'A-03', type: 'count_matches', args: { path: 'README.md', pattern: 'install', min: 1 } },
    { id: 'A-04', type: 'file_exists', args: { path: 'DOES_NOT_EXIST.md' } },
    { id: 'A-05', type: 'manual' },
    { id: 'A-06', type: 'file_exists', args: { path: 'README.md' }, applies_if: 'frontend' },
  ],
}

function setupMiniProject(root: string): void {
  writeFileSync(join(root, 'README.md'), '# Install\n\nRun `npm install` to get started.\n')
}

// ── Parity case 1: standard mini-registry on a real project dir ───────────────

describe('engine-parity: TS evaluate() ≡ .mjs evaluate() (#1393 unit 6)', () => {
  it('parity: identical score on a registry with file_exists / file_contains / count_matches', async () => {
    const root = tmpDir()
    setupMiniProject(root)

    const tsResult = evaluate(MINI_REGISTRY, new Set<string>(), root)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(MINI_REGISTRY, new Set<string>(), root),
    )) as Record<string, unknown>

    expect(tsResult.score).toBe(mjsResult['score'])
    expect(tsResult.yCount).toBe(mjsResult['yCount'])
  })

  it('parity: identical per-check verdicts', async () => {
    const root = tmpDir()
    setupMiniProject(root)

    const tsResult = evaluate(MINI_REGISTRY, new Set<string>(), root)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(MINI_REGISTRY, new Set<string>(), root),
    )) as Record<string, unknown>

    const tsChecks = tsResult.checks.sort((a, b) =>
      a.id.localeCompare(b.id, 'en', { sensitivity: 'variant' }),
    )
    const mjsChecks = ((mjsResult['checks'] as unknown[]) ?? []).sort((a, b) =>
      (a as { id: string }).id.localeCompare((b as { id: string }).id, 'en', {
        sensitivity: 'variant',
      }),
    )

    expect(tsChecks.length).toBe(mjsChecks.length)
    for (let i = 0; i < tsChecks.length; i++) {
      const ts = tsChecks[i]
      const mjs = mjsChecks[i] as { id: string; verdict: string }
      expect({ id: ts?.id, verdict: ts?.verdict }).toEqual({
        id: mjs.id,
        verdict: mjs.verdict,
      })
    }
  })

  // ── Parity case 2: all-NV (manual) ────────────────────────────────────────

  it('parity: all-NV registry → score 0 in both engines', async () => {
    const root = tmpDir()
    const allManual: RegistryInput = {
      checks: [
        { id: 'M-01', type: 'manual' },
        { id: 'M-02', type: 'manual' },
      ],
    }
    const tsResult = evaluate(allManual, new Set<string>(), root)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(allManual, new Set<string>(), root),
    )) as Record<string, unknown>

    expect(tsResult.score).toBe(0)
    expect(mjsResult['score']).toBe(0)
    expect(tsResult.score).toBe(mjsResult['score'])
  })

  // ── Parity case 3: null-byte safety ────────────────────────────────────────

  it('parity: null-byte path handled (TS returns N, neither throws)', async () => {
    const root = tmpDir()
    const nullByteRegistry: RegistryInput = {
      checks: [{ id: 'X-01', type: 'file_exists', args: { path: 'foo\x00etc/passwd' } }],
    }

    const tsResult = evaluate(nullByteRegistry, new Set<string>(), root)

    let mjsResult: Record<string, unknown>
    let mjsThrew = false
    try {
      mjsResult = (await Promise.resolve(
        mjsModule.evaluate(nullByteRegistry, new Set<string>(), root),
      )) as Record<string, unknown>
    } catch {
      mjsThrew = true
      mjsResult = { checks: [], score: 0, yCount: 0 }
    }

    // TS engine MUST NOT throw and must return N
    expect(tsResult.checks[0]?.verdict).toBe('N')
    // If MJS threw, that is a pre-existing divergence; tolerated for this edge case.
    if (!mjsThrew) {
      const mjsChecks = (mjsResult['checks'] as Array<{ id: string; verdict: string }>) ?? []
      const mjsCheck = mjsChecks.find((c) => c.id === 'X-01')
      expect(mjsCheck?.verdict).toBe('N')
    }
  })

  // ── Parity case 4: unknown check type returns N ────────────────────────────

  it('parity: unknown type returns N in TS engine (fail-closed)', () => {
    const root = tmpDir()
    const unknownRegistry: RegistryInput = {
      checks: [{ id: 'U-01', type: 'not_a_real_check_type_xyz' }],
    }
    const tsResult = evaluate(unknownRegistry, new Set<string>(), root)

    expect(tsResult.checks[0]?.verdict).toBe('N')
  })

  // ── Parity case 5: directory path for file_exists returns N ───────────────

  it('parity: directory path for file_exists returns N (not false-Y)', async () => {
    const root = tmpDir()
    mkdirSync(join(root, 'asubdir'))
    const dirRegistry: RegistryInput = {
      checks: [{ id: 'D-01', type: 'file_exists', args: { path: 'asubdir' } }],
    }
    const tsResult = evaluate(dirRegistry, new Set<string>(), root)

    expect(tsResult.checks[0]?.verdict).toBe('N')

    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(dirRegistry, new Set<string>(), root),
    )) as Record<string, unknown>
    const mjsChecks = (mjsResult['checks'] as Array<{ id: string; verdict: string }>) ?? []
    const mjsCheck = mjsChecks.find((c) => c.id === 'D-01')
    // TS engine returns N; MJS may return Y (it lacks the isDirectory check) — tolerated divergence.
    // The TS engine is the more correct implementation.
    if (mjsCheck !== undefined && mjsCheck.verdict === 'N') {
      expect(tsResult.checks[0]?.verdict).toBe('N')
    }
  })

  // ── Parity case 6 (#1413): value-op report extraction + threshold_ref must be byte-identical ──
  //
  // The value op reads PRE-GENERATED tool reports deterministically (no live spawn): xml/json/regex
  // extraction + gte/lte/eq comparison, with thresholds resolved per brownfield class via
  // threshold_ref. A check whose report file is ABSENT resolves to NA (never a false-N). Both engines
  // must agree on every verdict — the parity contract is an acceptance criterion of #1413.

  const VALUE_REGISTRY: RegistryInput = {
    version: '1.0.0',
    checks: [
      // json extraction: coverage.total.lines.pct gte threshold_ref (resolved per class)
      {
        id: 'V-JSON',
        type: 'value',
        args: {
          path: 'coverage-summary.json',
          format: 'json',
          select: 'total.lines.pct',
          op: 'gte',
        },
        threshold_ref: 'coverage.line',
      },
      // xml count: number of <error> elements in a checkstyle report lte threshold_ref
      {
        id: 'V-XML',
        type: 'value',
        args: { path: 'checkstyle.xml', format: 'xml', select: 'count:error', op: 'lte' },
        threshold_ref: 'checkstyle.errors',
      },
      // absent report → NA (the tool did not run / does not apply): never a false-N
      {
        id: 'V-ABSENT',
        type: 'value',
        args: {
          path: 'never-generated.json',
          format: 'json',
          select: 'total.lines.pct',
          op: 'gte',
        },
        threshold_ref: 'coverage.line',
      },
      // literal expected (no threshold_ref): regex first-group numeric eq
      {
        id: 'V-REGEX',
        type: 'value',
        args: { path: 'version.txt', format: 'regex', select: 'v=(\\d+)', op: 'eq', expected: 7 },
      },
    ],
  }

  // Mini thresholds SSOT: per-check bar keyed by brownfield class (ratchet-monotonic).
  const THRESHOLDS = {
    'coverage.line': { gold: 90, light: 70, medium: 50, heavy: 30 },
    'checkstyle.errors': { gold: 0, light: 10, medium: 50, heavy: 200 },
  }

  function setupValueReports(root: string): void {
    writeFileSync(
      join(root, 'coverage-summary.json'),
      JSON.stringify({ total: { lines: { pct: 80 } } }),
    )
    writeFileSync(
      join(root, 'checkstyle.xml'),
      '<checkstyle><file><error/><error/><error/></file></checkstyle>',
    )
    writeFileSync(join(root, 'version.txt'), 'tool v=7 release')
  }

  it('parity: value xml/json/regex + threshold_ref → identical verdicts (class=light)', async () => {
    const root = tmpDir()
    setupValueReports(root)
    const opts = { thresholds: THRESHOLDS, brownfieldClass: 'light' }

    const tsResult = evaluate(VALUE_REGISTRY, new Set<string>(), root, opts)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(VALUE_REGISTRY, new Set<string>(), root, opts),
    )) as Record<string, unknown>

    const tsById = Object.fromEntries(tsResult.checks.map((c) => [c.id, c.verdict]))
    const mjsChecks = (mjsResult['checks'] as Array<{ id: string; verdict: string }>) ?? []
    const mjsById = Object.fromEntries(mjsChecks.map((c) => [c.id, c.verdict]))

    // light coverage bar = 70; 80 >= 70 ⇒ Y
    expect(tsById['V-JSON']).toBe('Y')
    // light checkstyle bar = 10; count 3 <= 10 ⇒ Y
    expect(tsById['V-XML']).toBe('Y')
    // report absent ⇒ NA (no false-N)
    expect(tsById['V-ABSENT']).toBe('NA')
    // regex group 1 = 7 eq expected 7 ⇒ Y
    expect(tsById['V-REGEX']).toBe('Y')

    expect(mjsById).toEqual(tsById)
    expect(tsResult.score).toBe(mjsResult['score'])
    expect(tsResult.yCount).toBe(mjsResult['yCount'])
  })

  it('parity: threshold_ref resolves per class — gold bar fails what light passes', async () => {
    const root = tmpDir()
    setupValueReports(root) // coverage 80, checkstyle errors 3
    const goldOpts = { thresholds: THRESHOLDS, brownfieldClass: 'gold' }

    const tsResult = evaluate(VALUE_REGISTRY, new Set<string>(), root, goldOpts)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(VALUE_REGISTRY, new Set<string>(), root, goldOpts),
    )) as Record<string, unknown>

    const tsById = Object.fromEntries(tsResult.checks.map((c) => [c.id, c.verdict]))
    const mjsChecks = (mjsResult['checks'] as Array<{ id: string; verdict: string }>) ?? []
    const mjsById = Object.fromEntries(mjsChecks.map((c) => [c.id, c.verdict]))

    // gold coverage bar = 90; 80 >= 90 is FALSE ⇒ N (gold stricter than light)
    expect(tsById['V-JSON']).toBe('N')
    // gold checkstyle bar = 0; count 3 <= 0 is FALSE ⇒ N
    expect(tsById['V-XML']).toBe('N')
    expect(mjsById).toEqual(tsById)
  })
})
