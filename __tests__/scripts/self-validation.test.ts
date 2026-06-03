// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const SCRIPT = resolve('scripts/self-validation.mjs')

function run() {
  const r = spawnSync('node', [SCRIPT], {
    encoding: 'utf-8',
    cwd: resolve('.'),
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

describe('self-validation.mjs (A/B/C gate drill harness)', () => {
  it('exits 0 when all gate scripts pass their A/B/C drill', () => {
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[DRILL]')
    expect(result.stdout).toContain('exit code contract')
    expect(result.stdout).toContain('pipe/tee hazard')
  })

  it('reports drill phase results (A clean, B drift, C error)', () => {
    const result = run()
    expect(result.stdout).toContain('A (clean)')
    expect(result.stdout).toContain('B (drift)')
    expect(result.stdout).toContain('C (error)')
  })

  it('shows PASS markers for phases that match expected exit code', () => {
    const result = run()
    expect(result.stdout).toContain('✓ PASS')
  })

  it('includes summary line with pass/fail counts', () => {
    const result = run()
    expect(result.stdout).toContain('Passed:')
    expect(result.stdout).toContain('Failed:')
  })
})
