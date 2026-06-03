// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/debt-report.mjs')

function run(cwd: string, args: string[] = []) {
  const r = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd,
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'debt-report-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('debt-report.mjs (gate: debt ratchet enforcement)', () => {
  it('exits 0 when no baseline exists (grace period)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stderr).toContain('debt-baseline.json not found')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when baseline version is not 2 (requires re-capture)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const scriptsDir = join(dir, 'scripts')
      mkdirSync(scriptsDir, { recursive: true })
      const baseline = {
        version: 1,
        capturedAt: '2026-01-01T00:00:00Z',
        commit: 'old',
        metrics: {},
      }
      writeFileSync(join(scriptsDir, 'debt-baseline.json'), JSON.stringify(baseline))
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('schema v1')
    } finally {
      cleanup()
    }
  })

  // NOTE: only the deterministic guard paths are tested here. Any case that
  // proceeds past the baseline guards invokes collectMetrics(cwd), which shells
  // out to real tools (eslint/tsc/jscpd) — slow (>20s, times out on a loaded CI
  // runner) and environment-dependent. Both cases above early-return before
  // collectMetrics, giving fast, deterministic coverage of the script's own
  // guard logic; the metric-comparison path is exercised by the real gate run.
})
