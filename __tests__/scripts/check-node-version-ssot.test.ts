// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const SCRIPT = resolve('scripts/check-node-version-ssot.mjs')

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

describe('check-node-version-ssot.mjs (INV-53)', () => {
  it('exits 0 when .nvmrc exists, is valid semver, and matches runtime major', () => {
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('OK')
    expect(result.stdout).toContain('node-version-ssot')
  })
})
