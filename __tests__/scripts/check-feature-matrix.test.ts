// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-feature-matrix.mjs')

const HEADER = `| feature_id | capability | kit_dims | level | status | code_ref | test_ref | doc_ref | issue_ref | note |
|---|---|---|---|---|---|---|---|---|---|`

// Covering all 77 dims N01..N77 (joined) — used for coverage tests
const ALL_DIMS = Array.from({ length: 77 }, (_, i) => `N${String(i + 1).padStart(2, '0')}`).join(
  ',',
)

function countStatus(rows: string[], status: string): number {
  return rows.filter((r) => {
    const cells = r.split('|').map((c) => c.trim())
    return cells[5] === status // column index 5 = status (after feature_id, capability, kit_dims, level)
  }).length
}

function makeMatrix(rows: string[]): string {
  const verified = countStatus(rows, 'Verified')
  const done = countStatus(rows, 'Done')
  const partial = countStatus(rows, 'Partial')
  const missing = countStatus(rows, 'Missing')
  return [
    '# FEATURE_MATRIX',
    '',
    '<!-- FEATURE_MATRIX_START -->',
    HEADER,
    ...rows,
    '<!-- FEATURE_MATRIX_END -->',
    '',
    '## Summary',
    '',
    `| Status | Count |`,
    `|---|---|`,
    `| Verified | ${verified} |`,
    `| Done | ${done} |`,
    `| Partial | ${partial} |`,
    `| Missing | ${missing} |`,
    `| **Total** | **${rows.length}** |`,
  ].join('\n')
}

interface RunResult {
  status: number
  stdout: string
}

function run(
  args: string[],
  matrixContent?: string,
  extraFiles: Record<string, string> = {},
): RunResult {
  const dir = mkdtempSync(join(tmpdir(), 'check-fm-test-'))
  try {
    if (matrixContent !== undefined) {
      // gate expects docs/internal/PRODUCT/FEATURE_MATRIX.md relative to cwd
      mkdirSync(join(dir, 'docs', 'internal', 'PRODUCT'), { recursive: true })
      writeFileSync(
        join(dir, 'docs', 'internal', 'PRODUCT', 'FEATURE_MATRIX.md'),
        matrixContent,
        'utf-8',
      )
    }
    // Stub kit catalog for tests
    mkdirSync(join(dir, 'src', 'kit'), { recursive: true })
    const dims = Array.from({ length: 77 }, (_, i) => ({
      id: `N${String(i + 1).padStart(2, '0')}`,
      name: `Dim ${i + 1}`,
      tml: 'L2',
      gate: 'BLOCKING',
      categoryRef: 'architecture',
    }))
    writeFileSync(join(dir, 'src', 'kit', 'catalog.json'), JSON.stringify(dims), 'utf-8')
    for (const [relPath, content] of Object.entries(extraFiles)) {
      const abs = join(dir, relPath)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, content, 'utf-8')
    }
    const r = spawnSync('node', [SCRIPT, '--check', ...args], {
      encoding: 'utf-8',
      cwd: dir,
    })
    return { status: r.status ?? 1, stdout: (r.stdout ?? '') + (r.stderr ?? '') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function runWithMatrix(content: string, extraArgs: string[] = []): RunResult {
  return run(extraArgs, content)
}

// ── Fixtures for source_ref upward resolution (#2163) ──
const AGENTS_MD_FIXTURE = [
  '# arbiter — AGENTS.md',
  '',
  '- **INV-42:** A real invariant used by the fixture',
].join('\n')

const ADR_README_FIXTURE = [
  '# Architectural Decision Records',
  '',
  '| # | Title | Status | Date | Superseded by |',
  '|---|---|---|---|---|',
  '| 007 | [A real ADR](007-a-real-adr.md) | Accepted | 2026-01-01 |  |',
].join('\n')

const PRD_MD_FIXTURE = ['# PRD', '', '## 5. Deployment shapes', '', 'Some content.'].join('\n')

describe('check-feature-matrix.mjs --check', () => {
  it('exits 2 when FEATURE_MATRIX.md is missing', () => {
    const { status } = run([])
    expect(status).toBe(2)
  })

  it('exits 0 on a minimal valid clean matrix', () => {
    const content = [
      '# FEATURE_MATRIX',
      '',
      '<!-- FEATURE_MATRIX_START -->',
      HEADER,
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Missing | | | | #1 | |`,
      '<!-- FEATURE_MATRIX_END -->',
      '',
      '## Summary',
      '',
      '| Status | Count |',
      '|---|---|',
      '| Verified | 0 |',
      '| Done | 0 |',
      '| Partial | 0 |',
      '| Missing | 1 |',
      '| **Total** | **1** |',
    ].join('\n')
    const { status } = runWithMatrix(content)
    expect(status).toBe(0)
  })

  it('exits 1 when Verified row is missing test_ref', () => {
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Verified | src/foo.ts |  | docs/foo.md | #1 | |`,
    ])
    const { status } = runWithMatrix(matrix)
    expect(status).toBe(1)
  })

  it('exits 1 when Done row is missing doc_ref', () => {
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Done | src/foo.ts | src/foo.test.ts | | | |`,
    ])
    const { status } = runWithMatrix(matrix)
    expect(status).toBe(1)
  })

  // #2413 AC-1: ref existence must be checked for ALL statuses, not just
  // Done/Verified — the audit found REQ-044 (Partial) pointing code_ref at a
  // never-existed file and REQ-054 (Partial) pointing doc_ref at the wrong dir.
  it('exits 1 when a Partial row has a code_ref that does not exist on disk', () => {
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Partial | src/commands/does-not-exist.ts | | | | |`,
    ])
    const { status, stdout } = runWithMatrix(matrix)
    expect(status).toBe(1)
    expect(stdout).toContain('code_ref')
    expect(stdout).toContain('File not found')
  })

  it('exits 1 when a Partial row has a doc_ref that does not exist on disk', () => {
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Partial | src/foo.ts | | docs/does-not-exist.md | | |`,
    ])
    const { status, stdout } = runWithMatrix(matrix)
    expect(status).toBe(1)
    expect(stdout).toContain('doc_ref')
    expect(stdout).toContain('File not found')
  })

  it('exits 1 when a Partial row has a test_ref that does not exist on disk', () => {
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Partial | src/foo.ts | __tests__/does-not-exist.test.ts | | | |`,
    ])
    const { status, stdout } = runWithMatrix(matrix)
    expect(status).toBe(1)
    expect(stdout).toContain('test_ref')
    expect(stdout).toContain('File not found')
  })

  it('exits 0 when a Partial row has refs that exist on disk', () => {
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Partial | src/foo.ts | src/foo.test.ts | docs/foo.md | | |`,
    ])
    const { status } = run([], matrix, {
      'src/foo.ts': '',
      'src/foo.test.ts': '',
      'docs/foo.md': '',
    })
    expect(status).toBe(0)
  })

  it('exits 1 when Missing row has no issue_ref', () => {
    const matrix = makeMatrix([`| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Missing | | | | | |`])
    const { status } = runWithMatrix(matrix)
    expect(status).toBe(1)
  })

  it('exits 1 when issue_ref is not #\\d+ format', () => {
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Missing | | | | TICKET-123 | |`,
    ])
    const { status } = runWithMatrix(matrix)
    expect(status).toBe(1)
  })

  it('exits 1 when KIT coverage gap exists (dim not in any row)', () => {
    // Only N01 in kit_dims — N02..N77 uncovered
    const matrix = makeMatrix([`| REQ-001 | Architecture | N01 | L2 | Missing | | | | #1 | |`])
    const { status } = runWithMatrix(matrix)
    expect(status).toBe(1)
  })

  it('exits 1 when summary counter does not match row count', () => {
    const content = [
      '# FEATURE_MATRIX',
      '',
      '<!-- FEATURE_MATRIX_START -->',
      HEADER,
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Missing | | | | #1 | |`,
      '<!-- FEATURE_MATRIX_END -->',
      '',
      '## Summary',
      '',
      '| Status | Count |',
      '|---|---|',
      '| Missing | 99 |', // wrong count
      '| **Total** | **99** |', // wrong total
    ].join('\n')
    const { status } = runWithMatrix(content)
    expect(status).toBe(1)
  })

  it('exits 1 at L3 when Done row has test_ref file that does not exist', () => {
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L3 | Done | src/foo.ts | __tests__/nonexistent.test.ts | docs/foo.md | | |`,
    ])
    const { status } = runWithMatrix(matrix, ['--level', 'L3'])
    expect(status).toBe(1)
  })

  it('exits 0 at L3 when Done rows have no test_ref (L3 rule not triggered at L2)', () => {
    // At L2, L3-DoD check is not applied — Done without test_ref is OK as long as refs resolve
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Missing | | | | #1 | |`,
    ])
    const { status } = runWithMatrix(matrix.replace('| Missing | 0 |', '| Missing | 1 |'))
    expect(status).toBe(0)
  })

  it('exits 1 at L4 when audit_trail dim row is missing code_ref', () => {
    // N08 is in audit_trail category in the real catalog; in our stub it's architecture
    // Use a real audit_trail fixture for this test
    const dir = mkdtempSync(join(tmpdir(), 'check-fm-l4-'))
    try {
      const dims = Array.from({ length: 77 }, (_, i) => ({
        id: `N${String(i + 1).padStart(2, '0')}`,
        name: `Dim ${i + 1}`,
        tml: 'L2',
        gate: 'BLOCKING',
        categoryRef: i === 7 ? 'audit_trail' : 'architecture', // N08 = index 7 = audit_trail
      }))
      mkdirSync(join(dir, 'src', 'kit'), { recursive: true })
      mkdirSync(join(dir, 'docs', 'internal', 'PRODUCT'), { recursive: true })
      writeFileSync(join(dir, 'src', 'kit', 'catalog.json'), JSON.stringify(dims), 'utf-8')
      // Row covers N08 (audit_trail) but has no code_ref
      const matrix = makeMatrix([
        `| REQ-001 | All non-audit | N01,N02,N03,N04,N05,N06,N07,N09,N10,N11,N12,N13,N14,N15,N16,N17,N18,N19,N20,N21,N22,N23,N24,N25,N26,N27,N28,N29,N30,N31,N32,N33,N34,N35,N36,N37,N38,N39,N40,N41,N42,N43,N44,N45,N46,N47,N48,N49,N50,N51,N52,N53,N54,N55,N56,N57,N58,N59,N60,N61,N62,N63,N64,N65,N66,N67,N68,N69,N70,N71,N72,N73,N74,N75,N76,N77 | L4 | Missing | | | | #1 | |`,
        `| REQ-002 | Audit trail | N08 | L4 | Partial |  | | | | No code_ref at L4 |`,
      ])
      writeFileSync(join(dir, 'docs', 'internal', 'PRODUCT', 'FEATURE_MATRIX.md'), matrix, 'utf-8')
      const r = spawnSync('node', [SCRIPT, '--check', '--level', 'L4'], {
        encoding: 'utf-8',
        cwd: dir,
      })
      expect(r.status ?? 1).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('emits WARN and exits 0 when Partial row has empty issue_ref (non-blocking)', () => {
    // Partial row with non-empty code_ref but no issue_ref — WARN fires, gate still passes
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Partial | src/foo.ts | | | | no issue tracked |`,
    ])
    const { status, stdout } = run([], matrix, { 'src/foo.ts': '' })
    expect(status).toBe(0)
    expect(stdout).toContain('lack a tracked issue_ref')
  })

  it('does NOT emit WARN when Partial row has issue_ref populated', () => {
    // Partial row with code_ref AND issue_ref — no governance-gap warning
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Partial | src/foo.ts | | | #42 | tracked |`,
    ])
    const { status, stdout } = run([], matrix, { 'src/foo.ts': '' })
    expect(status).toBe(0)
    expect(stdout).not.toContain('lack a tracked issue_ref')
  })
})

describe('KIT catalog error handling (#1196)', () => {
  const MINIMAL_MATRIX = makeMatrix([
    `| REQ-001 | Architecture | N01 | L2 | Partial | src/foo.ts | | | | |`,
  ])

  it('exits 2 when KIT catalog exists but contains corrupt JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-fm-corrupt-'))
    try {
      mkdirSync(join(dir, 'docs', 'internal', 'PRODUCT'), { recursive: true })
      writeFileSync(
        join(dir, 'docs', 'internal', 'PRODUCT', 'FEATURE_MATRIX.md'),
        MINIMAL_MATRIX,
        'utf-8',
      )
      mkdirSync(join(dir, 'src', 'kit'), { recursive: true })
      writeFileSync(join(dir, 'src', 'kit', 'catalog.json'), '{ not valid json', 'utf-8')
      const r = spawnSync('node', [SCRIPT, '--check'], { encoding: 'utf-8', cwd: dir })
      expect(r.status).toBe(2)
      expect((r.stdout ?? '') + (r.stderr ?? '')).toContain('cannot read/parse KIT catalog')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 with WARN when KIT catalog is absent (intentional fail-open)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-fm-nocatalog-'))
    try {
      mkdirSync(join(dir, 'docs', 'internal', 'PRODUCT'), { recursive: true })
      writeFileSync(
        join(dir, 'docs', 'internal', 'PRODUCT', 'FEATURE_MATRIX.md'),
        MINIMAL_MATRIX,
        'utf-8',
      )
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'src', 'foo.ts'), '', 'utf-8')
      // no src/kit/catalog.json
      const r = spawnSync('node', [SCRIPT, '--check'], { encoding: 'utf-8', cwd: dir })
      expect(r.status).toBe(0)
      expect((r.stdout ?? '') + (r.stderr ?? '')).toContain('KIT catalog not found')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('source_ref upward resolution (#2163)', () => {
  const FIXTURES = {
    'AGENTS.md': AGENTS_MD_FIXTURE,
    'docs/internal/ADR/README.md': ADR_README_FIXTURE,
    'docs/PRODUCT/PRD.md': PRD_MD_FIXTURE,
    'src/foo.ts': '',
  }

  function runWithSourceRef(sourceRefCell: string): RunResult {
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Partial | src/foo.ts | | | | | ${sourceRefCell} |`,
    ])
    return run([], matrix, FIXTURES)
  }

  it('INV-NN resolving to a real AGENTS.md entry exits 0', () => {
    const { status } = runWithSourceRef('INV-42')
    expect(status).toBe(0)
  })

  it('INV-NN with no matching AGENTS.md entry exits 1, naming row and anchor', () => {
    const { status, stdout } = runWithSourceRef('INV-99')
    expect(status).toBe(1)
    expect(stdout).toContain('REQ-001')
    expect(stdout).toContain('INV-99')
  })

  it('ADR-NNN resolving to a real ADR README index row exits 0', () => {
    const { status } = runWithSourceRef('ADR-007')
    expect(status).toBe(0)
  })

  it('ADR-NNN with no matching ADR README row exits 1, naming row and anchor', () => {
    const { status, stdout } = runWithSourceRef('ADR-999')
    expect(status).toBe(1)
    expect(stdout).toContain('REQ-001')
    expect(stdout).toContain('ADR-999')
  })

  it('PRD §N resolving to a real numbered PRD heading exits 0', () => {
    const { status } = runWithSourceRef('PRD §5')
    expect(status).toBe(0)
  })

  it('PRD §N with no matching PRD heading exits 1, naming row and anchor', () => {
    const { status, stdout } = runWithSourceRef('PRD §99')
    expect(status).toBe(1)
    expect(stdout).toContain('REQ-001')
    expect(stdout).toContain('PRD §99')
  })

  it('issue-form (#NNN) source_ref is format-only — never a false red', () => {
    const { status } = runWithSourceRef('#123')
    expect(status).toBe(0)
  })

  it('freeform/legacy-declared source_ref text is format-only — never a false red', () => {
    const { status } = runWithSourceRef('legacy: some prose anchor')
    expect(status).toBe(0)
  })

  it('multiple comma-separated anchors: only the unresolvable one fails', () => {
    const { status, stdout } = runWithSourceRef('INV-42, ADR-999')
    expect(status).toBe(1)
    expect(stdout).toContain('ADR-999')
    expect(stdout).not.toContain('INV-42:')
  })

  it('empty source_ref cell (10-column row, backward compatible) exits 0', () => {
    // Real 10-column rows already produce a trailing empty 11th cell artifact —
    // must not be misread as an anchor to resolve.
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Partial | src/foo.ts | | | | no issue tracked |`,
    ])
    const { status } = run([], matrix, FIXTURES)
    expect(status).toBe(0)
  })
})

describe('tests_ref glob ban (#2163)', () => {
  const GLOB_BASELINE_PATH = 'scripts/data/feature-matrix-glob-baseline.json'
  const GLOB_TEST_REF = 'modules/trip/*Test.java'

  function baselineFile(entries: string[]): string {
    return JSON.stringify(
      {
        schema: 'arbiter-feature-matrix-glob-baseline-v1',
        generated_at: '2026-01-01T00:00:00.000Z',
        doctrine: 'fixture',
        entries,
      },
      null,
      2,
    )
  }

  it('Verified row with a glob test_ref FAILs even with a matching baseline entry (D4)', () => {
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Verified | src/foo.ts | ${GLOB_TEST_REF} | docs/foo.md | #1 | |`,
    ])
    const { status } = run([], matrix, {
      [GLOB_BASELINE_PATH]: baselineFile([`REQ-001::${GLOB_TEST_REF}`]),
    })
    expect(status).toBe(1)
  })

  it('Done row with a new glob test_ref (absent from baseline) FAILs', () => {
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Done | src/foo.ts | ${GLOB_TEST_REF} | docs/foo.md | | |`,
    ])
    const { status } = run([], matrix, { [GLOB_BASELINE_PATH]: baselineFile([]) })
    expect(status).toBe(1)
  })

  it('Done row with a glob test_ref already present in the baseline PASSes (ratchet)', () => {
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Done | src/foo.ts | ${GLOB_TEST_REF} | docs/foo.md | | |`,
    ])
    const { status } = run([], matrix, {
      [GLOB_BASELINE_PATH]: baselineFile([`REQ-001::${GLOB_TEST_REF}`]),
      // Done requires code_ref/doc_ref to exist on disk (existence check, unrelated
      // to the glob-ban ratchet under test) — real files so only the glob rule is exercised.
      'src/foo.ts': '',
      'docs/foo.md': '',
    })
    expect(status).toBe(0)
  })

  it('--update-baseline recomputes the baseline from current Done-glob rows and exits 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-fm-baseline-'))
    try {
      mkdirSync(join(dir, 'docs', 'internal', 'PRODUCT'), { recursive: true })
      const matrix = makeMatrix([
        `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Done | src/foo.ts | ${GLOB_TEST_REF} | docs/foo.md | | |`,
      ])
      writeFileSync(join(dir, 'docs', 'internal', 'PRODUCT', 'FEATURE_MATRIX.md'), matrix, 'utf-8')
      mkdirSync(join(dir, 'src', 'kit'), { recursive: true })
      writeFileSync(join(dir, 'src', 'kit', 'catalog.json'), '[]', 'utf-8')
      const r = spawnSync('node', [SCRIPT, '--update-baseline'], { encoding: 'utf-8', cwd: dir })
      expect(r.status ?? 1).toBe(0)
      const written = JSON.parse(readFileSync(join(dir, GLOB_BASELINE_PATH), 'utf-8')) as {
        entries: string[]
      }
      expect(written.entries).toContain(`REQ-001::${GLOB_TEST_REF}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('corrupt baseline JSON on --check exits 2', () => {
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Done | src/foo.ts | src/foo.test.ts | docs/foo.md | | |`,
    ])
    const { status } = run([], matrix, { [GLOB_BASELINE_PATH]: '{ not valid json' })
    expect(status).toBe(2)
  })
})

describe('verification_tier enum (12th column, #2242)', () => {
  it('exits 0 with a valid tier value (SCAFFOLD|GATE|E2E)', () => {
    for (const tier of ['SCAFFOLD', 'GATE', 'E2E']) {
      const matrix = makeMatrix([
        `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Partial | src/foo.ts | | | | | | ${tier} |`,
      ])
      const { status } = run([], matrix, { 'src/foo.ts': '' })
      expect(status, `tier ${tier} should pass`).toBe(0)
    }
  })

  it('exits 1 with an invalid tier value, naming the row and value', () => {
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Partial | src/foo.ts | | | | | | BOGUS |`,
    ])
    const { status, stdout } = runWithMatrix(matrix)
    expect(status).toBe(1)
    expect(stdout).toContain('REQ-001')
    expect(stdout).toContain('BOGUS')
  })

  it('empty tier cell (10/11-column row, backward compatible) exits 0', () => {
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Partial | src/foo.ts | | | | no tier yet |`,
    ])
    const { status } = run([], matrix, { 'src/foo.ts': '' })
    expect(status).toBe(0)
  })
})

describe('determinism (#2163)', () => {
  it('failures are reported in sorted order regardless of row order', () => {
    const matrix = makeMatrix([
      `| REQ-002 | Architecture | ${ALL_DIMS} | L2 | Missing | | | | | |`,
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Missing | | | | | |`,
    ])
    const { status, stdout } = runWithMatrix(matrix)
    expect(status).toBe(1)
    const idxReq001 = stdout.indexOf('REQ-001:')
    const idxReq002 = stdout.indexOf('REQ-002:')
    expect(idxReq001).toBeGreaterThan(-1)
    expect(idxReq002).toBeGreaterThan(-1)
    expect(idxReq001).toBeLessThan(idxReq002)
  })
})

// ── Span-pinned refs: OUTDATED detection (#2480 wave 4, RTM axis 1) ──────────
//
// A ref may name a line span, and today `normalizeRef` strips the anchor before the existence
// check — so `src/x.ts#L10-L20` is tolerated but never verified. The span can point past the end
// of the file, or at lines that have since become something else entirely, and the matrix still
// reads Verified. This is exactly the "the requirement changed, the test did not" failure the RTM
// exists to catch, and nothing catches it.
//
// Two rules, both additive: an unpinned ref keeps behaving as it does today.
//   1. A line span must EXIST — a range past the end of the file is a defect, not a rounding error.
//   2. A ref may carry `@<hash>` over the span's exact text. A mismatch is OUTDATED: the cited
//      lines moved or changed, so the citation no longer proves what the row claims.
describe('span-pinned refs (#2480 — RTM axis 1)', () => {
  const SRC = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].join('\n')
  const pinOf = (from: number, to: number): string =>
    createHash('sha256')
      .update(
        SRC.split('\n')
          .slice(from - 1, to)
          .join('\n'),
      )
      .digest('hex')
      .slice(0, 12)

  const rowWith = (ref: string): string =>
    `| REQ-001 | Cap | ${ALL_DIMS} | L2 | Partial | ${ref} |  |  | #1 | n |`

  it('accepts a line span that exists', () => {
    const r = run([], makeMatrix([rowWith('src/x.ts#L2-L4')]), { 'src/x.ts': SRC })
    expect(r.status).toBe(0)
  })

  it('rejects a line span that runs past the end of the file', () => {
    const r = run([], makeMatrix([rowWith('src/x.ts#L4-L99')]), { 'src/x.ts': SRC })
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/L4-L99/)
  })

  it('rejects a reversed line span', () => {
    const r = run([], makeMatrix([rowWith('src/x.ts#L4-L2')]), { 'src/x.ts': SRC })
    expect(r.status).toBe(1)
  })

  it('accepts a pin whose hash matches the cited span', () => {
    const r = run([], makeMatrix([rowWith(`src/x.ts#L2-L4@${pinOf(2, 4)}`)]), { 'src/x.ts': SRC })
    expect(r.status).toBe(0)
  })

  it('reports OUTDATED when the cited span no longer hashes to its pin', () => {
    const r = run([], makeMatrix([rowWith('src/x.ts#L2-L4@000000000000')]), { 'src/x.ts': SRC })
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/OUTDATED/)
    expect(r.stdout).toMatch(/L2-L4/)
  })

  it('catches the real failure: the pin still matches its own span after unrelated edits above it', () => {
    // The span moved down by one line. Its CONTENT is unchanged, but the citation now points at
    // different lines — which is precisely what a line-number citation cannot survive and a hash
    // must catch.
    const shifted = ['inserted', ...SRC.split('\n')].join('\n')
    const r = run([], makeMatrix([rowWith(`src/x.ts#L2-L4@${pinOf(2, 4)}`)]), {
      'src/x.ts': shifted,
    })
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/OUTDATED/)
  })

  it('leaves an unpinned ref with no anchor exactly as it was', () => {
    const r = run([], makeMatrix([rowWith('src/x.ts')]), { 'src/x.ts': SRC })
    expect(r.status).toBe(0)
  })

  it('still reports a missing file before it ever looks at the span', () => {
    const r = run([], makeMatrix([rowWith('src/gone.ts#L1-L2')]), { 'src/x.ts': SRC })
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/File not found/)
  })

  it('--pin emits a ref that then validates, so a pin is producible and not hand-computed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-fm-pin-'))
    try {
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'src', 'x.ts'), SRC, 'utf-8')
      const r = spawnSync('node', [SCRIPT, '--pin', 'src/x.ts#L2-L4'], {
        encoding: 'utf-8',
        cwd: dir,
      })
      expect(r.status).toBe(0)
      expect((r.stdout ?? '').trim()).toBe(`src/x.ts#L2-L4@${pinOf(2, 4)}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
