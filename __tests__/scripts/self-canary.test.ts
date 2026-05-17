// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const SCRIPT = resolve('scripts/run-self-canary.mjs')
const MOCK_NO_DRIFT = resolve('__tests__/fixtures/mock-canary-no-drift.mjs')
const MOCK_DRIFT = resolve('__tests__/fixtures/mock-canary-drift.mjs')

function run(args: string[] = []): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd: resolve('.'),
    timeout: 30000,
  })
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

describe('run-self-canary (#654)', () => {
  it('exits 1 and prints usage when --dry-run flag is missing', () => {
    const result = run([])
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/--dry-run/)
  })

  it('exits 0 when mock binary produces no output (no drift)', () => {
    const result = run(['--dry-run', '--arbiter-bin', MOCK_NO_DRIFT])
    expect(result.status).toBe(0)
    expect(result.stderr).not.toMatch(/TypeError|ReferenceError|SyntaxError/)
    expect(result.stdout + result.stderr).toMatch(/no drift|clean|ok/i)
  })

  it('exits 1 and reports drift when mock binary produces output', () => {
    const result = run(['--dry-run', '--arbiter-bin', MOCK_DRIFT])
    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toMatch(/drift/i)
  })
})
