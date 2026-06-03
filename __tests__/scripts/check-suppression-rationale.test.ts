// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-suppression-rationale.mjs')

function run(cwd: string) {
  const r = spawnSync('node', [SCRIPT], {
    encoding: 'utf-8',
    cwd,
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'suppression-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-suppression-rationale.mjs (INV-89)', () => {
  it('exits 0 when no suppressions/ directory exists', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('SKIP')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when pii-allowlist.json has all entries with adequate rationale (>= 20 chars)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const suppDir = join(dir, 'suppressions')
      mkdirSync(suppDir)
      writeFileSync(
        join(suppDir, 'pii-allowlist.json'),
        JSON.stringify([
          {
            file: '__tests__/',
            reason:
              'All emails under __tests__/ are fixture data — fake addresses required by integration test inputs.',
            owner: 'core',
            expiresAt: '2026-12-31',
            scope: 'pii-allowlist',
          },
        ]),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when an entry has thin rationale (< 20 chars)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const suppDir = join(dir, 'suppressions')
      mkdirSync(suppDir)
      writeFileSync(
        join(suppDir, 'pii-allowlist.json'),
        JSON.stringify([
          {
            file: '__tests__/',
            reason: 'Short reason',
            owner: 'core',
          },
        ]),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
      expect(result.stderr).toContain('thin reason')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when an entry reason is missing entirely', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const suppDir = join(dir, 'suppressions')
      mkdirSync(suppDir)
      writeFileSync(
        join(suppDir, 'pii-allowlist.json'),
        JSON.stringify([
          {
            file: '__tests__/',
            owner: 'core',
          },
        ]),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when an entry reason is whitespace-only', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const suppDir = join(dir, 'suppressions')
      mkdirSync(suppDir)
      writeFileSync(
        join(suppDir, 'pii-allowlist.json'),
        JSON.stringify([
          {
            file: '__tests__/',
            reason: '   \n  \t  ',
            owner: 'core',
          },
        ]),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when multiple entries have thin rationale, reports all', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const suppDir = join(dir, 'suppressions')
      mkdirSync(suppDir)
      writeFileSync(
        join(suppDir, 'pii-allowlist.json'),
        JSON.stringify([
          {
            file: 'src/a.ts',
            reason: 'too short',
          },
          {
            file: 'src/b.ts',
            reason: 'also bad',
          },
        ]),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('2/2')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when inline-suppressions.json is empty array', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const suppDir = join(dir, 'suppressions')
      mkdirSync(suppDir)
      writeFileSync(join(suppDir, 'inline-suppressions.json'), '[]')
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when both suppression files are valid', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const suppDir = join(dir, 'suppressions')
      mkdirSync(suppDir)
      writeFileSync(
        join(suppDir, 'pii-allowlist.json'),
        JSON.stringify([
          {
            file: 'src/a.ts',
            reason: 'This is a very valid reason with enough characters.',
          },
        ]),
      )
      writeFileSync(
        join(suppDir, 'inline-suppressions.json'),
        JSON.stringify([
          {
            rule: 'some-rule',
            reason: 'Another perfectly adequate rationale text here.',
          },
        ]),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 0 on real repo (cwd = repo root)', () => {
    const result = run(resolve('.'))
    expect(result.status).toBe(0)
  })
})
