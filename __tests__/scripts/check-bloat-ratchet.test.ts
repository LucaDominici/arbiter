// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const SCRIPT = resolve('scripts/check-bloat-ratchet.mjs')

function run(env?: Record<string, string>) {
  // ALLOW_BLOAT is a session-scoped bypass (CONTRIBUTING.md). Inherited from the
  // ambient environment it would silence the ratchet in the child and turn the
  // real-ratchet assertions below into a false red, so scrub it and let each case
  // opt in explicitly via `env`.
  const base = { ...process.env }
  delete base.ALLOW_BLOAT
  const r = spawnSync('node', [SCRIPT], {
    encoding: 'utf-8',
    cwd: resolve('.'),
    env: { ...base, ...env },
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

describe('check-bloat-ratchet.mjs (CANON-16 / INV-46 — file-count + LOC ratchet)', () => {
  it('exits 0 when run against repo root with clean baseline', () => {
    const result = run()
    expect(result.status).toBe(0)
  })

  it('exits 0 when ALLOW_BLOAT=1 is set (bypass)', () => {
    const result = run({ ALLOW_BLOAT: '1' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('ALLOW_BLOAT=1')
  })

  it('outputs success message on clean ratchet', () => {
    const result = run()
    expect(result.stdout).toContain('ratchet OK')
  })
})
