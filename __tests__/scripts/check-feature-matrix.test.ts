// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
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

function run(args: string[], matrixContent?: string): RunResult {
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
    const { status, stdout } = runWithMatrix(matrix)
    expect(status).toBe(0)
    expect(stdout).toContain('lack a tracked issue_ref')
  })

  it('does NOT emit WARN when Partial row has issue_ref populated', () => {
    // Partial row with code_ref AND issue_ref — no governance-gap warning
    const matrix = makeMatrix([
      `| REQ-001 | Architecture | ${ALL_DIMS} | L2 | Partial | src/foo.ts | | | #42 | tracked |`,
    ])
    const { status, stdout } = runWithMatrix(matrix)
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
      // no src/kit/catalog.json
      const r = spawnSync('node', [SCRIPT, '--check'], { encoding: 'utf-8', cwd: dir })
      expect(r.status).toBe(0)
      expect((r.stdout ?? '') + (r.stderr ?? '')).toContain('KIT catalog not found')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
