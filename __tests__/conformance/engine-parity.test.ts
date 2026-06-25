// SPDX-License-Identifier: Apache-2.0
// TDD red: unit 6 for #1393 — cross-engine parity gate.
// Asserts that the TS engine (src/conformance/engine.ts) and the .mjs evaluator
// (scripts/lib/gold-audit-lib.mjs) produce identical verdicts, score, and yCount
// on shared mini-registry test cases.
// Uses dynamic import() (not spawnSync) to preserve the JS value boundary.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, symlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evaluate, type RegistryInput, type Evidence } from '../../src/conformance/engine.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const MJS_PATH = join(REPO_ROOT, 'scripts/lib/gold-audit-lib.mjs')

// MJS evaluate(registry, overlays, root, options?) — same signature as the TS engine.
let mjsModule: {
  evaluate: (
    registry: unknown,
    overlays: Set<string> | readonly string[],
    root: string,
    options?: unknown,
  ) => unknown
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

  // ── Parity case 5 (#1470): directory + missing file_exists are FULLY identical ──────
  // Previously a tolerated divergence (the .mjs lacked the isDirectory check and returned a
  // different evidence shape). The dispatch refactor unified both engines: a directory ⇒ N
  // 'is a directory', a missing path ⇒ N 'missing', both carrying evidence.file. Now asserted
  // byte-identical (verdict + evidence) — no tolerance.

  it('parity: directory + missing file_exists → byte-identical N across engines (#1470)', async () => {
    const root = tmpDir()
    mkdirSync(join(root, 'asubdir'))
    const dirRegistry: RegistryInput = {
      checks: [
        { id: 'D-01', type: 'file_exists', args: { path: 'asubdir' } },
        { id: 'D-02', type: 'file_exists', args: { path: 'nope.md' } },
      ],
    }
    const tsResult = evaluate(dirRegistry, new Set<string>(), root)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(dirRegistry, new Set<string>(), root),
    )) as Record<string, unknown>

    const shape = (c: { verdict: string; evidence: Evidence | null }) => ({
      verdict: c.verdict,
      evidence: c.evidence,
    })
    const tsById = Object.fromEntries(tsResult.checks.map((c) => [c.id, shape(c)]))
    const mjsChecks =
      (mjsResult['checks'] as Array<{ id: string; verdict: string; evidence: Evidence | null }>) ??
      []
    const mjsById = Object.fromEntries(mjsChecks.map((c) => [c.id, shape(c)]))

    expect(tsById['D-01']).toEqual({
      verdict: 'N',
      evidence: { file: 'asubdir', detail: 'is a directory' },
    })
    expect(tsById['D-02']).toEqual({
      verdict: 'N',
      evidence: { file: 'nope.md', detail: 'missing' },
    })
    expect(mjsById).toEqual(tsById)
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

  // ── Parity case 7 (#1470): version_consistency must be byte-identical across engines ──
  const VC_REGISTRY: RegistryInput = {
    version: '1.0.0',
    checks: [
      {
        id: 'VC-Y',
        type: 'version_consistency',
        args: {
          version_file: 'VERSION',
          changelog_file: 'CHANGELOG.md',
          changelog_pattern: '^##\\s*\\[?(\\d+\\.\\d+\\.\\d+)',
        },
      },
      {
        id: 'VC-P',
        type: 'version_consistency',
        args: {
          version_file: 'VERSION',
          changelog_file: 'OLD_CHANGELOG.md',
          changelog_pattern: '^##\\s*\\[?(\\d+\\.\\d+\\.\\d+)',
        },
      },
      {
        id: 'VC-N',
        type: 'version_consistency',
        args: {
          version_file: 'NO_VERSION',
          changelog_file: 'CHANGELOG.md',
          changelog_pattern: '^##\\s*\\[?(\\d+\\.\\d+\\.\\d+)',
        },
      },
    ],
  }

  it('parity: version_consistency Y/P/N identical across engines (#1470)', async () => {
    const root = tmpDir()
    writeFileSync(join(root, 'VERSION'), '1.4.0\n')
    writeFileSync(join(root, 'CHANGELOG.md'), '## [1.4.0]\n- x\n')
    writeFileSync(join(root, 'OLD_CHANGELOG.md'), '## [1.3.0]\n- old\n')

    const tsResult = evaluate(VC_REGISTRY, new Set<string>(), root)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(VC_REGISTRY, new Set<string>(), root),
    )) as Record<string, unknown>

    const tsById = Object.fromEntries(tsResult.checks.map((c) => [c.id, c.verdict]))
    const mjsChecks = (mjsResult['checks'] as Array<{ id: string; verdict: string }>) ?? []
    const mjsById = Object.fromEntries(mjsChecks.map((c) => [c.id, c.verdict]))

    expect(tsById['VC-Y']).toBe('Y')
    expect(tsById['VC-P']).toBe('P')
    expect(tsById['VC-N']).toBe('N')
    expect(mjsById).toEqual(tsById)
    expect(tsResult.score).toBe(mjsResult['score'])
    expect(tsResult.yCount).toBe(mjsResult['yCount'])
  })

  // ── Parity case 7b (G2): version_select (JSON version source) identical across engines ──
  const VC_JSON_REGISTRY: RegistryInput = {
    version: '1.0.0',
    checks: [
      {
        id: 'VCJ-Y',
        type: 'version_consistency',
        args: {
          version_file: 'package.json',
          version_select: 'version',
          changelog_file: 'CHANGELOG.md',
          changelog_pattern: '^##\\s*\\[?(\\d+\\.\\d+\\.\\d+)',
        },
      },
      {
        id: 'VCJ-P',
        type: 'version_consistency',
        args: {
          version_file: 'package.json',
          version_select: 'missing',
          changelog_file: 'CHANGELOG.md',
          changelog_pattern: '^##\\s*\\[?(\\d+\\.\\d+\\.\\d+)',
        },
      },
    ],
  }

  it('parity: version_select JSON source identical across engines (G2)', async () => {
    const root = tmpDir()
    writeFileSync(join(root, 'package.json'), '{ "name": "demo", "version": "1.4.0" }\n')
    writeFileSync(join(root, 'CHANGELOG.md'), '## [1.4.0]\n- x\n')

    const tsResult = evaluate(VC_JSON_REGISTRY, new Set<string>(), root)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(VC_JSON_REGISTRY, new Set<string>(), root),
    )) as Record<string, unknown>

    const tsById = Object.fromEntries(tsResult.checks.map((c) => [c.id, c.verdict]))
    const mjsChecks = (mjsResult['checks'] as Array<{ id: string; verdict: string }>) ?? []
    const mjsById = Object.fromEntries(mjsChecks.map((c) => [c.id, c.verdict]))

    expect(tsById['VCJ-Y']).toBe('Y')
    expect(tsById['VCJ-P']).toBe('P')
    expect(mjsById).toEqual(tsById)
    expect(tsResult.score).toBe(mjsResult['score'])
  })

  // ── Parity case 8 (#1470): safeResolve + empty-capture edge surface MUST agree across engines.
  // These paths previously diverged (the .mjs safeResolve rejected any '..' substring + empty string
  // and skipped the null-byte check; shared.ts did not), so version_consistency could verdict-split.
  const VC_EDGE_REGISTRY: RegistryInput = {
    version: '1.0.0',
    checks: [
      // 'sub/../VERSION' normalizes to 'VERSION' in-root — must be accepted (read) in BOTH engines.
      {
        id: 'E-DOTDOT-IN',
        type: 'version_consistency',
        args: {
          version_file: 'sub/../VERSION',
          changelog_file: 'CHANGELOG.md',
          changelog_pattern: '^##\\s*\\[?(\\d+\\.\\d+\\.\\d+)',
        },
      },
      // a literal '..' inside a directory name ('x..y') is in-root — must be accepted in BOTH.
      {
        id: 'E-DOTDOT-NAME',
        type: 'version_consistency',
        args: {
          version_file: 'x..y/VERSION',
          changelog_file: 'CHANGELOG.md',
          changelog_pattern: '^##\\s*\\[?(\\d+\\.\\d+\\.\\d+)',
        },
      },
      // a true traversal escape must be N (invalid path) in BOTH.
      {
        id: 'E-ESCAPE',
        type: 'version_consistency',
        args: {
          version_file: '../escape/VERSION',
          changelog_file: 'CHANGELOG.md',
          changelog_pattern: '^##\\s*\\[?(\\d+\\.\\d+\\.\\d+)',
        },
      },
      // an empty trimmed VERSION must be P (indeterminate), never a false Y.
      {
        id: 'E-EMPTY',
        type: 'version_consistency',
        args: {
          version_file: 'EMPTY_VERSION',
          changelog_file: 'CHANGELOG.md',
          changelog_pattern: '^##\\s*\\[?(\\d+\\.\\d+\\.\\d+)',
        },
      },
    ],
  }

  it('parity: version_consistency safeResolve + empty-capture edges identical across engines (#1470)', async () => {
    const root = tmpDir()
    writeFileSync(join(root, 'VERSION'), '1.4.0\n')
    writeFileSync(join(root, 'CHANGELOG.md'), '## [1.4.0]\n- x\n')
    mkdirSync(join(root, 'x..y'))
    writeFileSync(join(root, 'x..y', 'VERSION'), '1.4.0\n')
    writeFileSync(join(root, 'EMPTY_VERSION'), '   \n')

    const tsResult = evaluate(VC_EDGE_REGISTRY, new Set<string>(), root)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(VC_EDGE_REGISTRY, new Set<string>(), root),
    )) as Record<string, unknown>

    const detailOf = (c: { verdict: string; evidence: { detail?: string } | null }) => ({
      verdict: c.verdict,
      detail: c.evidence?.detail ?? null,
    })
    const tsById = Object.fromEntries(tsResult.checks.map((c) => [c.id, detailOf(c)]))
    const mjsChecks =
      (mjsResult['checks'] as Array<{
        id: string
        verdict: string
        evidence: { detail?: string } | null
      }>) ?? []
    const mjsById = Object.fromEntries(mjsChecks.map((c) => [c.id, detailOf(c)]))

    // in-root '..' paths are read ⇒ Y in BOTH (previously mjs returned N 'invalid path')
    expect(tsById['E-DOTDOT-IN'].verdict).toBe('Y')
    expect(tsById['E-DOTDOT-NAME'].verdict).toBe('Y')
    // a true traversal escape ⇒ N in BOTH
    expect(tsById['E-ESCAPE'].verdict).toBe('N')
    // empty trimmed VERSION ⇒ P (never a false Y)
    expect(tsById['E-EMPTY'].verdict).toBe('P')
    // verdict AND evidence.detail byte-identical across the two engines
    expect(mjsById).toEqual(tsById)
  })

  // ── Parity case 9 (#1470): forbidden_pattern (must-NOT-appear) full ladder ──────────
  // A glob selects files; a regex must be absent from all of them. The anti-fake-green ladder
  // (empty/invalid pattern, invalid glob, non-literal/un-rationalised excludes, all-excluded,
  // 0-match-NA, found-N, absent-Y) must be byte-identical across engines.
  const FP_REGISTRY: RegistryInput = {
    version: '1.0.0',
    checks: [
      // pattern absent across src/**/*.ts ⇒ Y
      {
        id: 'FP-Y',
        type: 'forbidden_pattern',
        args: { glob: 'src/**/*.ts', pattern: 'XYZZY_NEVER' },
      },
      // pattern present in src/b.ts ⇒ N (first SORTED offending file)
      {
        id: 'FP-N',
        type: 'forbidden_pattern',
        args: { glob: 'src/**/*.ts', pattern: 'FORBIDDEN' },
      },
      // glob matches no files ⇒ NA (nothing of this kind exists)
      {
        id: 'FP-NA',
        type: 'forbidden_pattern',
        args: { glob: 'nope/**/*.py', pattern: 'FORBIDDEN' },
      },
      // exclude removes the only offending file (with rationale) ⇒ Y (top-level src/*.ts only)
      {
        id: 'FP-EXCL-Y',
        type: 'forbidden_pattern',
        args: {
          glob: 'src/*.ts',
          pattern: 'FORBIDDEN',
          exclude_paths: ['src/b.ts'],
          rationale: 'b.ts is a fixture',
        },
      },
      // exclude removes ALL matched files ⇒ N (refuse to fake-green an emptied scan)
      {
        id: 'FP-EXCL-ALL',
        type: 'forbidden_pattern',
        args: {
          glob: 'src/only/*.ts',
          pattern: 'FORBIDDEN',
          exclude_paths: ['src/only/x.ts'],
          rationale: 'all excluded',
        },
      },
      // exclude_paths present but no rationale ⇒ N
      {
        id: 'FP-NO-RAT',
        type: 'forbidden_pattern',
        args: { glob: 'src/**/*.ts', pattern: 'FORBIDDEN', exclude_paths: ['src/b.ts'] },
      },
      // exclude entry with a glob char ⇒ N (literal-only)
      {
        id: 'FP-GLOB-EXCL',
        type: 'forbidden_pattern',
        args: {
          glob: 'src/**/*.ts',
          pattern: 'FORBIDDEN',
          exclude_paths: ['src/*.ts'],
          rationale: 'x',
        },
      },
      // empty pattern ⇒ N
      { id: 'FP-EMPTY', type: 'forbidden_pattern', args: { glob: 'src/**/*.ts', pattern: '' } },
      // invalid regex ⇒ N
      { id: 'FP-BADRE', type: 'forbidden_pattern', args: { glob: 'src/**/*.ts', pattern: '(' } },
      // invalid (traversal) glob ⇒ N
      { id: 'FP-BADGLOB', type: 'forbidden_pattern', args: { glob: '../escape/**', pattern: 'x' } },
    ],
  }

  it('parity: forbidden_pattern full ladder identical across engines (#1470)', async () => {
    const root = tmpDir()
    mkdirSync(join(root, 'src', 'only'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.ts'), 'const a = 1\n')
    writeFileSync(join(root, 'src', 'b.ts'), 'const b = 2 // FORBIDDEN marker\n')
    writeFileSync(join(root, 'src', 'c.ts'), 'const c = 3\n')
    writeFileSync(join(root, 'src', 'only', 'x.ts'), 'const x = 1 // FORBIDDEN here too\n')

    const tsResult = evaluate(FP_REGISTRY, new Set<string>(), root)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(FP_REGISTRY, new Set<string>(), root),
    )) as Record<string, unknown>

    const shape = (c: { verdict: string; evidence: Evidence | null }) => ({
      verdict: c.verdict,
      evidence: c.evidence,
    })
    const tsById = Object.fromEntries(tsResult.checks.map((c) => [c.id, shape(c)]))
    const mjsChecks =
      (mjsResult['checks'] as Array<{ id: string; verdict: string; evidence: Evidence | null }>) ??
      []
    const mjsById = Object.fromEntries(mjsChecks.map((c) => [c.id, shape(c)]))

    expect(tsById['FP-Y'].verdict).toBe('Y')
    expect(tsById['FP-N'].verdict).toBe('N')
    expect(tsById['FP-N'].evidence?.file).toBe('src/b.ts')
    expect(tsById['FP-NA'].verdict).toBe('NA')
    expect(tsById['FP-EXCL-Y'].verdict).toBe('Y')
    expect(tsById['FP-EXCL-ALL'].verdict).toBe('N')
    expect(tsById['FP-NO-RAT'].verdict).toBe('N')
    expect(tsById['FP-GLOB-EXCL'].verdict).toBe('N')
    expect(tsById['FP-EMPTY'].verdict).toBe('N')
    expect(tsById['FP-BADRE'].verdict).toBe('N')
    expect(tsById['FP-BADGLOB'].verdict).toBe('N')
    // every verdict AND evidence byte-identical across engines
    expect(mjsById).toEqual(tsById)
  })

  // ── Parity case 10 (#1470): file_stat (executable bit on a glob) ─────────────────────
  // Only the exec bit (mode & 0o111) is portable. all exec ⇒ Y, some ⇒ P, none ⇒ N; valid glob
  // matching 0 files ⇒ NA; malformed glob ⇒ N; a non-executable bit request ⇒ N; core.fileMode
  // false ⇒ NA. Both engines must agree byte-for-byte.
  const FS_REGISTRY: RegistryInput = {
    version: '1.0.0',
    checks: [
      { id: 'FS-Y', type: 'file_stat', args: { glob: 'bin/*.sh', bit: 'executable' } },
      { id: 'FS-N', type: 'file_stat', args: { glob: 'plain/*.sh' } },
      { id: 'FS-P', type: 'file_stat', args: { glob: 'mixed/*.sh' } },
      { id: 'FS-NA', type: 'file_stat', args: { glob: 'nope/*.sh' } },
      { id: 'FS-BADGLOB', type: 'file_stat', args: { glob: '../escape/*' } },
      { id: 'FS-BADBIT', type: 'file_stat', args: { glob: 'bin/*.sh', bit: 'readable' } },
    ],
  }

  it('parity: file_stat exec-bit ladder identical across engines (#1470)', async () => {
    const root = tmpDir()
    for (const d of ['bin', 'plain', 'mixed']) mkdirSync(join(root, d), { recursive: true })
    writeFileSync(join(root, 'bin', 'run.sh'), '#!/bin/sh\necho hi\n')
    chmodSync(join(root, 'bin', 'run.sh'), 0o755)
    writeFileSync(join(root, 'plain', 'a.sh'), '#!/bin/sh\n')
    chmodSync(join(root, 'plain', 'a.sh'), 0o644)
    writeFileSync(join(root, 'mixed', 'x.sh'), '#!/bin/sh\n')
    chmodSync(join(root, 'mixed', 'x.sh'), 0o755)
    writeFileSync(join(root, 'mixed', 'y.sh'), '#!/bin/sh\n')
    chmodSync(join(root, 'mixed', 'y.sh'), 0o644)

    const tsResult = evaluate(FS_REGISTRY, new Set<string>(), root)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(FS_REGISTRY, new Set<string>(), root),
    )) as Record<string, unknown>

    const shape = (c: { verdict: string; evidence: Evidence | null }) => ({
      verdict: c.verdict,
      evidence: c.evidence,
    })
    const tsById = Object.fromEntries(tsResult.checks.map((c) => [c.id, shape(c)]))
    const mjsChecks =
      (mjsResult['checks'] as Array<{ id: string; verdict: string; evidence: Evidence | null }>) ??
      []
    const mjsById = Object.fromEntries(mjsChecks.map((c) => [c.id, shape(c)]))

    expect(tsById['FS-Y'].verdict).toBe('Y')
    expect(tsById['FS-N'].verdict).toBe('N')
    expect(tsById['FS-P'].verdict).toBe('P')
    expect(tsById['FS-NA'].verdict).toBe('NA')
    expect(tsById['FS-BADGLOB'].verdict).toBe('N')
    expect(tsById['FS-BADBIT'].verdict).toBe('N')
    expect(mjsById).toEqual(tsById)
  })

  // ── Parity case 11 (#1470): file_stat NA when git core.fileMode is disabled ──────────
  it('parity: file_stat → NA when core.fileMode=false (unmeasurable exec bit) (#1470)', async () => {
    const root = tmpDir()
    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(join(root, '.git', 'config'), '[core]\n\tfilemode = false\n')
    mkdirSync(join(root, 'bin'), { recursive: true })
    writeFileSync(join(root, 'bin', 'run.sh'), '#!/bin/sh\n')
    chmodSync(join(root, 'bin', 'run.sh'), 0o644) // would be N if exec-bit were measured

    const reg: RegistryInput = {
      checks: [{ id: 'FS-NOFM', type: 'file_stat', args: { glob: 'bin/*.sh' } }],
    }
    const tsResult = evaluate(reg, new Set<string>(), root)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(reg, new Set<string>(), root),
    )) as Record<string, unknown>
    const mjsChecks = (mjsResult['checks'] as Array<{ id: string; verdict: string }>) ?? []
    expect(tsResult.checks[0]?.verdict).toBe('NA')
    expect(mjsChecks.find((c) => c.id === 'FS-NOFM')?.verdict).toBe('NA')
  })

  // ── Parity case 12 (#1470): FULL-PAYLOAD deep-equal over atypical field types ────────
  // The per-check {verdict} / {verdict,evidence} maps used above are blind to metadata-type coercion.
  // This case asserts the ENTIRE payload (score + totals + dimensions + every checks[] field) is
  // deep-equal across engines on a registry with EVERY field deliberately mis-typed: a numeric
  // version, a YAML-quoted string weight, a numeric id/dimension/title/anchor, a falsy anchor:0
  // (must coerce to null), and a missing path — the exact divergences an unquoted templated YAML
  // registry would otherwise trip silently (parseYaml types bare scalars as numbers).
  const FULL_REGISTRY = {
    version: 5,
    checks: [
      {
        id: 'A-W',
        type: 'file_exists',
        args: { path: 'README.md' },
        weight: '2',
        dimension: 7,
        title: 99,
        anchor: 42,
        risk: 'SAFE',
      },
      { id: 'B-P', type: 'file_exists', dimension: 'D-A' }, // missing args.path ⇒ N invalid path
      {
        id: 123,
        type: 'file_contains',
        args: { path: 'README.md', pattern: 'install' },
        weight: 3,
        dimension: 'D-B',
        anchor: 0,
      },
      { id: 'C-M', type: 'manual', dimension: 'D-B' },
    ],
  } as unknown as RegistryInput

  it('parity: full payload deep-equal on string weight + numeric id + missing path (#1470)', async () => {
    const root = tmpDir()
    writeFileSync(join(root, 'README.md'), '# Install\n\nRun `npm install`.\n')

    const tsResult = evaluate(FULL_REGISTRY, new Set<string>(), root)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(FULL_REGISTRY, new Set<string>(), root),
    )) as Record<string, unknown>

    // string weight '2' must SUM (not concatenate); numeric id must coerce; missing path ⇒ N.
    expect(tsResult.score).toBe(83.3)
    // the ENTIRE scored payload is byte-identical across the two engines.
    expect(mjsResult).toEqual(tsResult)
  })

  // ── Parity case 13 (#1470): forbidden_pattern must NOT fake-green an unreadable file ──────
  // A matched, non-excluded file that cannot be read must yield N (cannot assert absence), never a
  // Y. Robust to the test UID: as non-root a chmod-000 file is unreadable ⇒ N 'unreadable'; as root
  // it is readable and (it holds the marker) ⇒ N 'forbidden pattern present'. Either way: N, and
  // both engines AGREE (same readText) — locking the anti-fake-green property in the parity gate.
  it('parity: forbidden_pattern → N (never Y) on an unreadable matched file (#1470)', async () => {
    // As root, chmod 000 does not restrict reads — skip (the unreadable branch can't be exercised).
    if (process.getuid?.() === 0) return
    const root = tmpDir()
    mkdirSync(join(root, 'src'), { recursive: true })
    const secret = join(root, 'src', 'secret.ts')
    writeFileSync(secret, 'const x = 1 // FORBIDDEN marker\n')
    chmodSync(secret, 0o000)
    try {
      const reg: RegistryInput = {
        checks: [
          {
            id: 'FP-UNREADABLE',
            type: 'forbidden_pattern',
            args: { glob: 'src/**/*.ts', pattern: 'FORBIDDEN' },
          },
        ],
      }
      const tsResult = evaluate(reg, new Set<string>(), root)
      const mjsResult = (await Promise.resolve(
        mjsModule.evaluate(reg, new Set<string>(), root),
      )) as Record<string, unknown>
      const mjsChecks = (mjsResult['checks'] as Array<{ id: string; verdict: string }>) ?? []

      // NEVER Y — an unread/unverified file cannot fake-green.
      expect(tsResult.checks[0]?.verdict).toBe('N')
      expect(mjsChecks.find((c) => c.id === 'FP-UNREADABLE')?.verdict).toBe('N')
      // both engines reach the SAME branch on the same file.
      expect(tsResult.checks[0]?.verdict).toBe(
        mjsChecks.find((c) => c.id === 'FP-UNREADABLE')?.verdict,
      )
    } finally {
      chmodSync(secret, 0o644) // restore so rmSync can clean up
    }
  })

  // ── Parity case 14 (#1470): numeric args.* must coerce identically (not throw/flip) ──────
  // parseYaml types a bare scalar (`pattern: 7`, `select: 5`) as a number. The .mjs String()-wraps
  // every text arg; the TS engine must too — else a numeric count_matches pattern flips Y→N and a
  // numeric value `select` THROWS and the top-level catch zeroes the WHOLE registry.
  const ARGS_REGISTRY = {
    version: '1',
    checks: [
      { id: 'CM-NUM', type: 'count_matches', args: { path: 'data.txt', pattern: 7, min: 1 } },
      { id: 'OK', type: 'file_exists', args: { path: 'data.txt' } },
      {
        id: 'V-NUMSEL',
        type: 'value',
        args: { path: 'rep.json', format: 'json', select: 5, op: 'gte', expected: 1 },
      },
    ],
  } as unknown as RegistryInput

  it('parity: numeric args.pattern/select coerce identically — no throw, no Y→N flip (#1470)', async () => {
    const root = tmpDir()
    writeFileSync(join(root, 'data.txt'), 'aaa7bbb\n')
    writeFileSync(join(root, 'rep.json'), '{"5":3}\n')

    const tsResult = evaluate(ARGS_REGISTRY, new Set<string>(), root)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(ARGS_REGISTRY, new Set<string>(), root),
    )) as Record<string, unknown>

    // numeric count_matches pattern 7 finds '7' ⇒ Y (not N); numeric json select 5 reads {"5":3} ⇒
    // 3 gte 1 ⇒ Y (not a thrown empty payload that would zero the sibling checks too).
    const byId = Object.fromEntries(tsResult.checks.map((c) => [c.id, c.verdict]))
    expect(byId['CM-NUM']).toBe('Y')
    expect(byId['OK']).toBe('Y')
    expect(byId['V-NUMSEL']).toBe('Y')
    expect(tsResult.checks.length).toBe(3) // NOT collapsed to an empty payload
    expect(mjsResult).toEqual(tsResult)
  })

  // ── Parity case 15 (#1470): a non-object check entry is dropped in BOTH engines ──────────
  it('parity: null/undefined check entries dropped, valid checks still scored (#1470)', async () => {
    const root = tmpDir()
    writeFileSync(join(root, 'README.md'), '# r\n')
    const reg = {
      checks: [null, undefined, { id: 'V', type: 'file_exists', args: { path: 'README.md' } }],
    } as unknown as RegistryInput

    const tsResult = evaluate(reg, new Set<string>(), root)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(reg, new Set<string>(), root),
    )) as Record<string, unknown>

    expect(tsResult.checks.length).toBe(1) // only the valid check survives — neither engine throws
    expect(tsResult.checks[0]?.verdict).toBe('Y')
    expect(mjsResult).toEqual(tsResult)
  })

  // ── Parity case 16 (#1470): file_stat must NOT fake-green the exec bit via a symlink ──────
  // A symlink's own lstat mode is always 0o777; trusting it lets a symlink→0644 file satisfy the
  // exec requirement. Both engines must treat a symlink as not-executable.
  it('parity: file_stat → not-Y on a symlink to a non-exec file (#1470)', async () => {
    const root = tmpDir()
    mkdirSync(join(root, 'bin'), { recursive: true })
    writeFileSync(join(root, 'bin', 'real.txt'), 'plain\n')
    chmodSync(join(root, 'bin', 'real.txt'), 0o644)
    symlinkSync(join(root, 'bin', 'real.txt'), join(root, 'bin', 'link.sh'))

    const reg: RegistryInput = {
      checks: [{ id: 'FS-LINK', type: 'file_stat', args: { glob: 'bin/link.sh' } }],
    }
    const tsResult = evaluate(reg, new Set<string>(), root)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(reg, new Set<string>(), root),
    )) as Record<string, unknown>
    const mjsChecks = (mjsResult['checks'] as Array<{ id: string; verdict: string }>) ?? []

    expect(tsResult.checks[0]?.verdict).not.toBe('Y') // symlink can't fake-green the exec bit
    expect(tsResult.checks[0]?.verdict).toBe('N')
    expect(mjsChecks.find((c) => c.id === 'FS-LINK')?.verdict).toBe('N')
  })

  // ── Parity case 17 (#1470): a trailing-slash root yields identical output (determinism) ──────
  it('parity: evaluate(root) deep-equals evaluate(root + "/") for glob check types (#1470)', async () => {
    const root = tmpDir()
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.ts'), 'const a = 1\n')
    const reg: RegistryInput = {
      checks: [
        { id: 'FP', type: 'forbidden_pattern', args: { glob: 'src/**/*.ts', pattern: 'NOPE' } },
      ],
    }
    const atRoot = evaluate(reg, new Set<string>(), root)
    const atSlash = evaluate(reg, new Set<string>(), root + '/')
    expect(atSlash).toEqual(atRoot) // a non-canonical root must not flip the verdict
    expect(atRoot.checks[0]?.verdict).toBe('Y')

    const mjsSlash = (await Promise.resolve(
      mjsModule.evaluate(reg, new Set<string>(), root + '/'),
    )) as Record<string, unknown>
    expect(mjsSlash).toEqual(atSlash)
  })

  // ── Parity case 18 (#1470): overlays passed as an ARRAY (not a Set) must not zero the payload ──
  // A loose JS caller may pass overlays as an array; both engines normalize it (overlays.has on an
  // array would otherwise throw and zero the whole registry in the TS twin).
  it('parity: array overlays normalized identically — applies_if check still scored (#1470)', async () => {
    const root = tmpDir()
    writeFileSync(join(root, 'README.md'), '# r\n')
    const reg: RegistryInput = {
      checks: [
        { id: 'A', type: 'file_exists', args: { path: 'README.md' }, applies_if: 'frontend' },
      ],
    }
    const tsResult = evaluate(reg, ['frontend'], root)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(reg, ['frontend'], root),
    )) as Record<string, unknown>

    expect(tsResult.checks.length).toBe(1) // NOT collapsed to an empty payload
    expect(tsResult.checks[0]?.verdict).toBe('Y') // overlay 'frontend' present ⇒ applicable ⇒ Y
    expect(mjsResult).toEqual(tsResult)
  })

  // ── Parity case 19 (#1470): a null `options` must normalize, not zero the payload ──────────
  it('parity: null options normalized identically — value+threshold_ref still scored (#1470)', async () => {
    const root = tmpDir()
    writeFileSync(join(root, 'rep.json'), '{"total":{"lines":{"pct":80}}}\n')
    const reg: RegistryInput = {
      checks: [
        {
          id: 'V',
          type: 'value',
          args: { path: 'rep.json', format: 'json', select: 'total.lines.pct', op: 'gte' },
          threshold_ref: 'coverage.line',
        },
      ],
    }
    const tsResult = evaluate(reg, new Set<string>(), root, null)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(reg, new Set<string>(), root, null),
    )) as Record<string, unknown>

    expect(tsResult.checks.length).toBe(1) // NOT collapsed; report present + no thresholds ⇒ N
    expect(tsResult.checks[0]?.verdict).toBe('N')
    expect(mjsResult).toEqual(tsResult)
  })

  // ── Parity case 20 (#1470): an XML attr selector with a regex metachar must not crash either engine ──
  // `select: 'attr:a@('` injects a regex metachar into extractXml's RegExp build. Unguarded it
  // throws — crashing the .mjs audit and zeroing the TS payload (wiping a valid sibling). Guarded,
  // both yield a per-check N and the sibling stays Y.
  it('parity: xml attr regex-injection → per-check N, sibling unaffected, no crash (#1470)', async () => {
    const root = tmpDir()
    writeFileSync(join(root, 'rep.xml'), '<a x="3"/>\n')
    const reg: RegistryInput = {
      checks: [
        { id: 'OK', type: 'file_exists', args: { path: 'rep.xml' } },
        {
          id: 'INJ',
          type: 'value',
          args: { path: 'rep.xml', format: 'xml', select: 'attr:a@(', op: 'gte', expected: 1 },
        },
      ],
    }
    const tsResult = evaluate(reg, new Set<string>(), root)
    const mjsResult = (await Promise.resolve(
      mjsModule.evaluate(reg, new Set<string>(), root),
    )) as Record<string, unknown>
    const byId = Object.fromEntries(tsResult.checks.map((c) => [c.id, c.verdict]))

    expect(tsResult.checks.length).toBe(2) // NOT collapsed — the metachar attr did not crash the audit
    expect(byId['OK']).toBe('Y') // the valid sibling is preserved
    expect(byId['INJ']).toBe('N') // injected attr ⇒ no metric ⇒ N
    expect(mjsResult).toEqual(tsResult)
  })

  // ── Parity case 21 (G1): generic applies_if preconditions ≡ across engines ──────────────
  // file_exists MET ⇒ evaluated · file_exists UNMET ⇒ NA · file_contains/count_matches/capability ·
  // and the fail-safe: a malformed precondition (unknown type / missing field) ⇒ APPLIES (not NA).
  it('parity: object-form applies_if preconditions are identical across engines (G1)', async () => {
    const root = tmpDir()
    writeFileSync(join(root, 'go.mod'), 'module x\n')
    writeFileSync(join(root, 'pkg.json'), '{"deps":{"react":"18"}}\n')
    writeFileSync(join(root, 'svc.yml'), 'service: a\nservice: b\n')
    writeFileSync(join(root, 'TARGET.md'), '# t\n')
    const reg: RegistryInput = {
      checks: [
        // MET ⇒ evaluated (Y)
        {
          id: 'P-EXIST-MET',
          type: 'file_exists',
          args: { path: 'TARGET.md' },
          applies_if: { type: 'file_exists', path: 'go.mod' },
        },
        // UNMET ⇒ NA
        {
          id: 'P-EXIST-UNMET',
          type: 'file_exists',
          args: { path: 'TARGET.md' },
          applies_if: { type: 'file_exists', path: 'absent.lock' },
        },
        // file_contains MET ⇒ Y
        {
          id: 'P-CONTAINS',
          type: 'file_exists',
          args: { path: 'TARGET.md' },
          applies_if: { type: 'file_contains', path: 'pkg.json', pattern: '"react"' },
        },
        // count_matches <min ⇒ NA
        {
          id: 'P-COUNT-NA',
          type: 'file_exists',
          args: { path: 'TARGET.md' },
          applies_if: { type: 'count_matches', path: 'svc.yml', pattern: 'service:', min: 3 },
        },
        // capability not in overlays ⇒ NA
        {
          id: 'P-CAP-NA',
          type: 'file_exists',
          args: { path: 'TARGET.md' },
          applies_if: { type: 'capability', name: 'regulated' },
        },
        // FAIL-SAFE: unknown type ⇒ APPLIES (Y, not NA)
        {
          id: 'P-MALFORMED',
          type: 'file_exists',
          args: { path: 'TARGET.md' },
          applies_if: { type: 'who_knows' } as never,
        },
      ],
    }
    const overlays = new Set<string>(['frontend'])
    const tsResult = evaluate(reg, overlays, root)
    const mjsResult = (await Promise.resolve(mjsModule.evaluate(reg, overlays, root))) as Record<
      string,
      unknown
    >
    const byId = Object.fromEntries(tsResult.checks.map((c) => [c.id, c.verdict]))

    expect(byId['P-EXIST-MET']).toBe('Y')
    expect(byId['P-EXIST-UNMET']).toBe('NA')
    expect(byId['P-CONTAINS']).toBe('Y')
    expect(byId['P-COUNT-NA']).toBe('NA')
    expect(byId['P-CAP-NA']).toBe('NA')
    expect(byId['P-MALFORMED']).toBe('Y') // fail-safe: never a silent skip
    expect(mjsResult).toEqual(tsResult)
  })
})
