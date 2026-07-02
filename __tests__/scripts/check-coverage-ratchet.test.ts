// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-coverage-ratchet.mjs')

type RunResult = { status: number; stdout: string; stderr: string }

function run(
  summary: string,
  baseline: string,
  extra: string[] = [],
  env: Record<string, string | undefined> = {},
): RunResult {
  const r = spawnSync('node', [SCRIPT, '--summary', summary, '--baseline', baseline, ...extra], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function makeTemp(): { dir: string; summary: string; baseline: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'cov-ratchet-test-'))
  return {
    dir,
    summary: join(dir, 'coverage-summary.json'),
    baseline: join(dir, 'coverage-baseline.json'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function writeSummary(path: string, pcts: Record<string, number>): void {
  const total = Object.fromEntries(
    Object.entries(pcts).map(([k, pct]) => [k, { total: 100, covered: pct, skipped: 0, pct }]),
  )
  writeFileSync(path, JSON.stringify({ total }))
}

// #1731: the exact v8 json-summary shape a broken-instrumentation sandbox emits —
// every metric structurally present but zeroed, pct the STRING 'Unknown' (not a number).
function writeEmptyInstrumentationSummary(path: string): void {
  const metric = { total: 0, covered: 0, skipped: 0, pct: 'Unknown' }
  writeFileSync(
    path,
    JSON.stringify({
      total: { lines: metric, branches: metric, functions: metric, statements: metric },
    }),
  )
}

const BASE = { lines: 89.4, branches: 78.1, functions: 93.4, statements: 87.8 }

describe('check-coverage-ratchet', () => {
  it('bootstraps a missing baseline from the summary and exits 0', () => {
    const t = makeTemp()
    try {
      writeSummary(t.summary, BASE)
      expect(existsSync(t.baseline)).toBe(false)
      const r = run(t.summary, t.baseline)
      expect(r.status).toBe(0)
      expect(existsSync(t.baseline)).toBe(true)
      expect(JSON.parse(readFileSync(t.baseline, 'utf-8')).lines).toBe(89.4)
    } finally {
      t.cleanup()
    }
  })

  it('passes when every metric is at or above baseline', () => {
    const t = makeTemp()
    try {
      writeFileSync(t.baseline, JSON.stringify(BASE))
      writeSummary(t.summary, { lines: 90.1, branches: 80.0, functions: 94, statements: 88 })
      expect(run(t.summary, t.baseline).status).toBe(0)
    } finally {
      t.cleanup()
    }
  })

  it('fails when a metric regresses beyond tolerance', () => {
    const t = makeTemp()
    try {
      writeFileSync(t.baseline, JSON.stringify(BASE))
      writeSummary(t.summary, { ...BASE, lines: 88.0 }) // -1.4pp on lines
      const r = run(t.summary, t.baseline)
      expect(r.status).toBe(1)
      expect(r.stderr + r.stdout).toMatch(/lines/)
    } finally {
      t.cleanup()
    }
  })

  it('tolerates a sub-epsilon dip (v8 jitter) without failing', () => {
    const t = makeTemp()
    try {
      writeFileSync(t.baseline, JSON.stringify(BASE))
      writeSummary(t.summary, { ...BASE, lines: 89.2 }) // -0.2pp, within tolerance
      expect(run(t.summary, t.baseline).status).toBe(0)
    } finally {
      t.cleanup()
    }
  })

  it('--update ratchets each metric monotonically upward (never down)', () => {
    const t = makeTemp()
    try {
      writeFileSync(t.baseline, JSON.stringify(BASE))
      writeSummary(t.summary, { lines: 91, branches: 77, functions: 95, statements: 89 })
      const r = run(t.summary, t.baseline, ['--update'])
      expect(r.status).toBe(0)
      const updated = JSON.parse(readFileSync(t.baseline, 'utf-8'))
      expect(updated.lines).toBe(91) // raised
      expect(updated.branches).toBe(78.1) // NOT lowered (kept baseline)
    } finally {
      t.cleanup()
    }
  })

  it('errors (exit 2) when the coverage summary is absent', () => {
    const t = makeTemp()
    try {
      writeFileSync(t.baseline, JSON.stringify(BASE))
      const r = run(t.summary, t.baseline)
      expect(r.status).toBe(2)
    } finally {
      t.cleanup()
    }
  })

  // #1731: known local-sandbox defect — some agent-worktree environments' v8 coverage
  // instrumentation collects 0 files (structurally valid summary, every metric zeroed,
  // pct the string 'Unknown'). This is a data-collection failure, not a real coverage
  // result, and must never be conflated with an actual regression (which always reports
  // genuine, if lower, numeric percentages).
  describe('empty-instrumentation signature (#1731)', () => {
    it('degrades to a loud WARN (exit 0) outside CI', () => {
      const t = makeTemp()
      try {
        writeFileSync(t.baseline, JSON.stringify(BASE))
        writeEmptyInstrumentationSummary(t.summary)
        const r = run(t.summary, t.baseline, [], { CI: undefined, GITHUB_ACTIONS: undefined })
        expect(r.status).toBe(0)
        expect(r.stdout + r.stderr).toMatch(/#1731/)
      } finally {
        t.cleanup()
      }
    })

    it('fails closed (exit 2) in CI — a genuinely empty summary in CI is a real problem', () => {
      const t = makeTemp()
      try {
        writeFileSync(t.baseline, JSON.stringify(BASE))
        writeEmptyInstrumentationSummary(t.summary)
        const r = run(t.summary, t.baseline, [], { CI: 'true' })
        expect(r.status).toBe(2)
      } finally {
        t.cleanup()
      }
    })

    it('does NOT degrade a merely-partial/corrupted summary (only the exact all-zero signature qualifies)', () => {
      const t = makeTemp()
      try {
        writeFileSync(t.baseline, JSON.stringify(BASE))
        // lines has a real numeric pct; the rest are the broken 'Unknown' shape —
        // NOT the known signature (all four must be zeroed) → stays a hard ERROR.
        writeFileSync(
          t.summary,
          JSON.stringify({
            total: {
              lines: { total: 100, covered: 90, skipped: 0, pct: 90 },
              branches: { total: 0, covered: 0, skipped: 0, pct: 'Unknown' },
              functions: { total: 0, covered: 0, skipped: 0, pct: 'Unknown' },
              statements: { total: 0, covered: 0, skipped: 0, pct: 'Unknown' },
            },
          }),
        )
        const r = run(t.summary, t.baseline, [], { CI: undefined, GITHUB_ACTIONS: undefined })
        expect(r.status).toBe(2)
      } finally {
        t.cleanup()
      }
    })
  })
})
