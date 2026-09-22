// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const REPO = resolve(import.meta.dirname, '../..')

describe('update preview modes', () => {
  it('rejects --dry-run with --adopt-plan instead of silently discarding one mode', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'update', '--dir', REPO, '--dry-run', '--adopt-plan', '--json'],
      { encoding: 'utf-8', timeout: 30_000 },
    )

    expect(result.status).toBe(2)
    const payload = JSON.parse(result.stdout) as { status: string; errors: string[] }
    expect(payload.status).toBe('error')
    expect(payload.errors.join(' ')).toContain('--dry-run and --adopt-plan cannot be combined')
  })
})
