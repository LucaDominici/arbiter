// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const SCRIPT = resolve('scripts/check-api-snapshot.mjs')
const SNAPSHOT_DIR = resolve('api')

function runSnapshot(env: Record<string, string> = {}): {
  status: number
  stdout: string
  stderr: string
} {
  const result = spawnSync('node', [SCRIPT], {
    encoding: 'utf-8',
    cwd: resolve('.'),
    env: { ...process.env, ...env },
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('check-api-snapshot.mjs (#602)', () => {
  it('script file exists', () => {
    expect(existsSync(SCRIPT)).toBe(true)
  })

  it('exits 0 when snapshots match current exports (no drift)', () => {
    const result = runSnapshot()
    expect(result.status).toBe(0)
  })

  it('snapshot files exist in api/ directory', () => {
    const expected = ['api/plugin.api.md', 'api/invariants.api.md', 'api/compatibility.api.md']
    for (const file of expected) {
      expect(existsSync(resolve(file)), `missing ${file}`).toBe(true)
    }
  })

  it('exits 1 on drift without BREAKING API CHANGE marker', () => {
    const snapshotFile = resolve(SNAPSHOT_DIR, 'plugin.api.md')
    if (!existsSync(snapshotFile)) return

    const original = readFileSync(snapshotFile, 'utf-8')
    // Replace the embedded hash with a fake one to simulate committed-snapshot drift
    const corrupted = original.replace(
      /api-snapshot hash:[0-9a-f]+/,
      'api-snapshot hash:deadbeefdeadbeef',
    )
    writeFileSync(snapshotFile, corrupted)
    try {
      const result = runSnapshot({ PR_BODY: 'No marker here' })
      expect(result.status).toBe(1)
    } finally {
      writeFileSync(snapshotFile, original)
    }
  })

  it('exits 0 on drift WITH BREAKING API CHANGE marker in PR_BODY', () => {
    const snapshotFile = resolve(SNAPSHOT_DIR, 'plugin.api.md')
    if (!existsSync(snapshotFile)) return

    const original = readFileSync(snapshotFile, 'utf-8')
    // Replace the embedded hash with a fake one to simulate committed-snapshot drift
    const corrupted = original.replace(
      /api-snapshot hash:[0-9a-f]+/,
      'api-snapshot hash:deadbeefdeadbeef',
    )
    writeFileSync(snapshotFile, corrupted)
    try {
      const result = runSnapshot({
        PR_BODY: 'This PR contains BREAKING API CHANGE: removed old export',
      })
      expect(result.status).toBe(0)
    } finally {
      writeFileSync(snapshotFile, original)
    }
  })
})
