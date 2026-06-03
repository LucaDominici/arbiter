// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const SCRIPT = resolve('scripts/check-hook-contracts.mjs')

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

describe('check-hook-contracts.mjs (hook doc contract enforcement)', () => {
  it('exits 0 when all .mjs hooks in .claude/hooks/ are documented in HOOK-CONTRACTS.md', () => {
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('check-hook-contracts: OK')
  })
})
