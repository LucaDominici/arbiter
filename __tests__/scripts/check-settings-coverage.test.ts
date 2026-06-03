// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const SCRIPT = resolve('scripts/check-settings-coverage.mjs')

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

describe('check-settings-coverage.mjs (settings catalog coverage)', () => {
  it('exits 0 when configure.ts ALLOWED_PATHS matches settings.ts SETTINGS_CATALOG in the real repo', () => {
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('OK')
  })
})
