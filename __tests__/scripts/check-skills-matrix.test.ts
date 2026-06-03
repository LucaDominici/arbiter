// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const SCRIPT = resolve('scripts/check-skills-matrix.mjs')

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

describe('check-skills-matrix.mjs (skills-matrix validation)', () => {
  it('exits 0 when skills-matrix.json is valid (real repo)', () => {
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[skills-matrix] PASS')
  })
})
