// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/gen-gap.test.ts
// TDD tests for scripts/gen-gap.mjs — generated GAP.md register.

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { collectData, buildGap, runCli, parseUnenforceable } from '../../scripts/gen-gap.mjs'

const SCRIPT = resolve('scripts/gen-gap.mjs')

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gen-gap-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

interface MatrixRow {
  id: string
  capability: string
  status: string
  issue?: string
  note?: string
}

function makeFixtures(
  dir: string,
  opts: {
    matrixRows?: MatrixRow[]
    convergenceRows?: Array<{ issue: string; title: string; status: string }>
    techDebt?: Array<{ subdir: string; issues: number[] }>
  } = {},
): void {
  const product = join(dir, 'docs', 'internal', 'PRODUCT')
  mkdirSync(product, { recursive: true })

  const defaultRows: MatrixRow[] = [
    { id: 'REQ-001', capability: 'Architecture enforcement', status: 'Verified' },
    { id: 'REQ-002', capability: 'Audit trail', status: 'Done' },
    { id: 'REQ-003', capability: 'Brownfield', status: 'Partial', note: 'partial impl' },
    {
      id: 'REQ-004',
      capability: 'Snapshot',
      status: 'Missing',
      issue: '#42',
      note: 'missing snap',
    },
  ]
  const rows = opts.matrixRows ?? defaultRows
  const tableRows = rows
    .map(
      (r) =>
        `| ${r.id} | ${r.capability} | N01 | L2 | ${r.status} | src/x.ts | | | ${r.issue ?? ''} | ${r.note ?? ''} |`,
    )
    .join('\n')
  writeFileSync(
    join(product, 'FEATURE_MATRIX.md'),
    [
      `---`,
      `title: 'FEATURE_MATRIX'`,
      `last_review: '2026-06-04'`,
      `---`,
      ``,
      `# FEATURE_MATRIX`,
      ``,
      `<!-- FEATURE_MATRIX_START -->`,
      `| feature_id | capability | kit_dims | level | status | code_ref | test_ref | doc_ref | issue_ref | note |`,
      `|---|---|---|---|---|---|---|---|---|---|`,
      tableRows,
      `<!-- FEATURE_MATRIX_END -->`,
    ].join('\n'),
  )

  if (opts.convergenceRows) {
    const tableContent = opts.convergenceRows
      .map((r) => `| ${r.issue} | ${r.title} | ${r.status} |`)
      .join('\n')
    writeFileSync(
      join(product, 'CONVERGENCE-2026-06.md'),
      [
        `# Convergence Report`,
        ``,
        `## Residual Follow-Up Issue Summary`,
        ``,
        `| Issue | Title | Status |`,
        `| ----- | ----- | ------ |`,
        tableContent,
        ``,
        `All residuals are tracked. None are blocking.`,
      ].join('\n'),
    )
  }

  if (opts.techDebt) {
    for (const { subdir, issues } of opts.techDebt) {
      const entryDir = join(dir, '.arbiter', 'evidence', subdir)
      mkdirSync(entryDir, { recursive: true })
      writeFileSync(join(entryDir, 'tech-debt.json'), JSON.stringify({ issues }))
    }
  }
}

// ---------------------------------------------------------------------------
// parseUnenforceable() — em-dash fixture
// ---------------------------------------------------------------------------

describe('parseUnenforceable()', () => {
  it('parses UNENFORCEABLE lines with em-dash separator', () => {
    // U+2014 em-dash, not a hyphen
    const stdout = '[UNENFORCEABLE] never store PII in logs — docs/SYSTEM/AGENTS.md:42\n'
    const result = parseUnenforceable(stdout)
    expect(result).toHaveLength(1)
    expect(result[0].signal).toBe('never store PII in logs')
    expect(result[0].doc).toBe('docs/SYSTEM/AGENTS.md')
    expect(result[0].line).toBe(42)
  })

  it('ignores lines without the UNENFORCEABLE prefix', () => {
    const stdout = '[COVERED] something — docs/X.md:1\n[UNENFORCEABLE] real one — docs/Y.md:7\n'
    const result = parseUnenforceable(stdout)
    expect(result).toHaveLength(1)
    expect(result[0].doc).toBe('docs/Y.md')
  })

  it('returns empty array on empty output', () => {
    expect(parseUnenforceable('')).toHaveLength(0)
  })

  it('rejects hyphen separator (not em-dash)', () => {
    const stdout = '[UNENFORCEABLE] bad signal - docs/X.md:1\n'
    expect(parseUnenforceable(stdout)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// collectData()
// ---------------------------------------------------------------------------

describe('collectData()', () => {
  it('throws when FEATURE_MATRIX.md is missing (fail-closed INV-96)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs', 'internal', 'PRODUCT'), { recursive: true })
      expect(() => collectData(dir)).toThrow(/FEATURE_MATRIX/)
    } finally {
      cleanup()
    }
  })

  it('emits one medium/blocksV1=false gap for a Partial row', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, {
        matrixRows: [
          { id: 'REQ-003', capability: 'Brownfield', status: 'Partial', note: 'partial impl' },
        ],
      })
      const data = collectData(dir)
      expect(data.featureGaps).toHaveLength(1)
      expect(data.featureGaps[0].severity).toBe('medium')
      expect(data.featureGaps[0].blocksV1).toBe(false)
    } finally {
      cleanup()
    }
  })

  it('emits one high/blocksV1=true gap for a Missing row', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, {
        matrixRows: [
          {
            id: 'REQ-004',
            capability: 'Snapshot',
            status: 'Missing',
            issue: '#42',
            note: 'missing',
          },
        ],
      })
      const data = collectData(dir)
      expect(data.featureGaps).toHaveLength(1)
      expect(data.featureGaps[0].severity).toBe('high')
      expect(data.featureGaps[0].blocksV1).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('emits zero gaps for Verified and Done rows', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, {
        matrixRows: [
          { id: 'REQ-001', capability: 'Architecture', status: 'Verified' },
          { id: 'REQ-002', capability: 'Audit', status: 'Done' },
        ],
      })
      const data = collectData(dir)
      expect(data.featureGaps).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  it('collects parked issue from convergence file into knownDebt', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, {
        matrixRows: [{ id: 'REQ-001', capability: 'Arch', status: 'Verified' }],
        convergenceRows: [
          {
            issue: '#1187',
            title: 'Epic: CI pipeline performance & drift fix',
            status: 'Parked post-v1 (existing)',
          },
        ],
      })
      const data = collectData(dir)
      expect(data.knownDebt.some((d) => d.issue === '#1187')).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('collects tech-debt.json issue into knownDebt with deterministic sort', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, {
        matrixRows: [{ id: 'REQ-001', capability: 'Arch', status: 'Verified' }],
        techDebt: [
          { subdir: 'run-a', issues: [1215] },
          { subdir: 'run-b', issues: [1216] },
        ],
      })
      const data = collectData(dir)
      const issues = data.knownDebt.map((d) => d.issue)
      // Both issues present
      expect(issues.some((i) => i.includes('1215'))).toBe(true)
      expect(issues.some((i) => i.includes('1216'))).toBe(true)
      // Sorted: run-a before run-b (alphabetic)
      const idxA = issues.findIndex((i) => i.includes('1215'))
      const idxB = issues.findIndex((i) => i.includes('1216'))
      expect(idxA).toBeLessThan(idxB)
    } finally {
      cleanup()
    }
  })

  it('returns empty enforcementGaps when constraint-scan script is absent', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir, {
        matrixRows: [{ id: 'REQ-001', capability: 'Arch', status: 'Verified' }],
      })
      const data = collectData(dir)
      // Constraint scan won't find scripts/ in temp dir → empty array
      expect(Array.isArray(data.enforcementGaps)).toBe(true)
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// buildGap()
// ---------------------------------------------------------------------------

describe('buildGap()', () => {
  function makeGapData(overrides: Partial<Parameters<typeof buildGap>[0]> = {}) {
    return buildGap({
      featureGaps: [],
      enforcementGaps: [],
      knownDebt: [],
      lastReview: '2026-06-04',
      ...overrides,
    })
  }

  it('contains GAP_START sentinel', () => {
    expect(makeGapData()).toContain('<!-- GAP_START -->')
  })

  it('contains GAP_END sentinel', () => {
    expect(makeGapData()).toContain('<!-- GAP_END -->')
  })

  it('places Missing row under ## v1 Blockers', () => {
    const out = makeGapData({
      featureGaps: [
        {
          id: 'REQ-004',
          area: 'Snapshot',
          status: 'Missing',
          missing: 'missing snap',
          issue: '#42',
          severity: 'high',
          blocksV1: true,
        },
      ],
    })
    const v1Idx = out.indexOf('## v1 Blockers')
    const featIdx = out.indexOf('## Feature Gaps')
    const reqIdx = out.indexOf('REQ-004')
    expect(v1Idx).toBeGreaterThan(-1)
    expect(reqIdx).toBeGreaterThan(v1Idx)
    expect(reqIdx).toBeLessThan(featIdx)
  })

  it('Partial row appears in ## Feature Gaps but NOT in ## v1 Blockers', () => {
    const out = makeGapData({
      featureGaps: [
        {
          id: 'REQ-003',
          area: 'Brownfield',
          status: 'Partial',
          missing: 'partial impl',
          issue: '',
          severity: 'medium',
          blocksV1: false,
        },
      ],
    })
    const v1Section = out.slice(out.indexOf('## v1 Blockers'), out.indexOf('## Feature Gaps'))
    expect(v1Section).not.toContain('REQ-003')
    expect(out).toContain('REQ-003')
  })

  it('shows "No v1-blocking gaps." when no blockers', () => {
    const out = makeGapData()
    expect(out).toContain('No v1-blocking gaps.')
  })

  it('places known-debt item in ## Known Debt section', () => {
    const out = makeGapData({
      knownDebt: [
        {
          issue: '#1187',
          title: 'Epic: CI pipeline performance',
          status: 'Parked post-v1',
          severity: 'low',
          blocksV1: false,
        },
      ],
    })
    const debtIdx = out.indexOf('## Known Debt')
    const issueIdx = out.indexOf('#1187')
    expect(debtIdx).toBeGreaterThan(-1)
    expect(issueIdx).toBeGreaterThan(debtIdx)
  })

  it('contains FEATURE_MATRIX.md in related frontmatter', () => {
    expect(makeGapData()).toContain('PRODUCT/FEATURE_MATRIX.md')
  })
})

// ---------------------------------------------------------------------------
// runCli()
// ---------------------------------------------------------------------------

describe('runCli()', () => {
  it('write mode: creates GAP.md and returns 0', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const gapPath = join(dir, 'docs', 'internal', 'PRODUCT', 'GAP.md')
      const code = await runCli(dir, gapPath, false)
      expect(code).toBe(0)
      const content = readFileSync(gapPath, 'utf-8')
      expect(content).toContain('<!-- GAP_START -->')
    } finally {
      cleanup()
    }
  })

  it('check mode: returns 1 when GAP.md is missing', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const gapPath = join(dir, 'docs', 'internal', 'PRODUCT', 'GAP.md')
      const code = await runCli(dir, gapPath, true)
      expect(code).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('check mode: returns 0 after write produces up-to-date file (idempotent)', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const gapPath = join(dir, 'docs', 'internal', 'PRODUCT', 'GAP.md')
      await runCli(dir, gapPath, false)
      const code = await runCli(dir, gapPath, true)
      expect(code).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('check mode: returns 1 when GAP.md has stale content', async () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const gapPath = join(dir, 'docs', 'internal', 'PRODUCT', 'GAP.md')
      writeFileSync(gapPath, '# Stale content\n')
      const code = await runCli(dir, gapPath, true)
      expect(code).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('returns 1 on IO error (missing source files)', async () => {
    const code = await runCli('/nonexistent/__gen_gap__', '/nonexistent/GAP.md', false)
    expect(code).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// CLI (spawnSync) — smoke tests
// ---------------------------------------------------------------------------

describe('gen-gap.mjs CLI', () => {
  it('--check exits 1 when GAP.md is missing', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      const result = spawnSync('node', [SCRIPT, '--check'], {
        encoding: 'utf-8',
        cwd: dir,
        env: { ...process.env, NODE_PATH: undefined },
      })
      expect(result.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('--write creates GAP.md then --check passes', () => {
    const { dir, cleanup } = makeTemp()
    try {
      makeFixtures(dir)
      spawnSync('node', [SCRIPT, '--write'], { encoding: 'utf-8', cwd: dir })
      const result = spawnSync('node', [SCRIPT, '--check'], { encoding: 'utf-8', cwd: dir })
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
