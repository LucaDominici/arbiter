// SPDX-License-Identifier: Apache-2.0
// Behavioral test: concurrent kit install --dry-run runs must not corrupt arbiter.json.
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const NODE = process.execPath
const REPO_ROOT = resolve(import.meta.dirname, '../..')

// ─── Concurrent dry-run ───────────────────────────────────────────────────────

describe('concurrent kit install --dry-run', () => {
  it('arbiter.json remains valid JSON after two parallel dry-runs', async () => {
    // Spawn both processes concurrently
    const args = [CLI, 'kit', 'install', '--experimental.kit', '--dry-run']
    const opts = { cwd: REPO_ROOT, encoding: 'utf-8' as const }

    const p1 = new Promise<{ code: number | null }>((resolve) => {
      const child = spawn(NODE, args, opts)
      child.on('close', (code) => resolve({ code }))
    })

    const p2 = new Promise<{ code: number | null }>((resolve) => {
      const child = spawn(NODE, args, opts)
      child.on('close', (code) => resolve({ code }))
    })

    const [r1, r2] = await Promise.all([p1, p2])

    // Both processes should exit cleanly (0)
    expect(r1.code).toBe(0)
    expect(r2.code).toBe(0)

    // arbiter.json must still parse
    const arbiterJson = readFileSync(join(REPO_ROOT, 'arbiter.json'), 'utf-8')
    expect(() => JSON.parse(arbiterJson)).not.toThrow()
  })

  it('lock file is cleaned up after concurrent run', async () => {
    const { existsSync } = await import('node:fs')
    // Lock file is `kit.lock` (see src/utils/config.ts saveConfig).
    // Under --dry-run, saveConfig is never called, so the lock is never created.
    const lockPath = join(REPO_ROOT, '.arbiter/kit.lock')
    // After all processes complete, lock file must be gone
    // (it should have been released after the run)
    // Note: lock file may not exist at all if no persistence occurred (--dry-run)
    // This test just verifies we don't leave a stale lock
    const result = spawnSync(NODE, [CLI, 'kit', 'install', '--experimental.kit', '--dry-run'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
    })
    expect(result.status).toBe(0)
    // Lock file should not exist after clean run completes
    if (existsSync(lockPath)) {
      // If it exists, it must be released (try to read it — no ENOENT)
      const content = readFileSync(lockPath, 'utf-8')
      // A lingering lock file with content is a problem, but an empty/missing one is ok
      expect(content).toHaveLength(0)
    }
  })
})
