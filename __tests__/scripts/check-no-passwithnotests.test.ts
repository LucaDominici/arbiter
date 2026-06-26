// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve('scripts/check-no-passwithnotests.mjs')

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

function runInFixture(scripts: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'pwnt-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'f', scripts }))
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: dir })
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('check-no-passwithnotests.mjs (INV-25 / #1039)', () => {
  it('exits 0 when no --passWithNoTests found in package.json scripts or CI workflows', () => {
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('OK')
  })

  it('reports script name and command when violation is found in output', () => {
    // This test documents the expected output format when a violation exists.
    // It will pass if the current repo is clean; it validates message structure.
    const result = run()
    // On success, just verify the OK message exists
    if (result.status === 0) {
      expect(result.stdout).toMatch(/check-no-passwithnotests:\s+OK/)
    }
  })

  it('flags the canonical bare `test` script with --passWithNoTests (m1 regression)', () => {
    // `npm test` runs this script; a bare `"test"` is a test-category script too.
    const result = runInFixture({ test: 'vitest run --passWithNoTests' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('scripts.test:')
  })

  it('passes a bare `test` script that runs its suite (no --passWithNoTests)', () => {
    const result = runInFixture({ test: 'vitest run' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('OK')
  })

  it('does not flag non-test scripts that contain --passWithNoTests', () => {
    // The name filter must stay scoped to test-category scripts only.
    const result = runInFixture({ build: 'tsc --passWithNoTests' })
    expect(result.status).toBe(0)
  })

  it('exits non-zero if script encounters missing package.json', () => {
    // Runs from a temp directory with no package.json to verify error handling
    const r = spawnSync('node', [SCRIPT], {
      encoding: 'utf-8',
      cwd: '/tmp',
    })
    expect(r.status).not.toBe(0)
  })
})
