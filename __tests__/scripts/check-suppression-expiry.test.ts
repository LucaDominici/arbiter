// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-suppression-expiry.mjs')

function run(tempDir: string, maxDays?: number) {
  const args = maxDays !== undefined ? ['--max-days', String(maxDays)] : []
  const r = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd: tempDir,
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'suppression-expiry-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-suppression-expiry.mjs (INV-89)', () => {
  it('exits 0 when suppressions/ directory does not exist', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('SKIP')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when all entries are within the default 365-day window', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const suppressionsDir = join(dir, 'suppressions')
      mkdirSync(suppressionsDir)

      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const futureDate = tomorrow.toISOString().split('T')[0]

      writeFileSync(
        join(suppressionsDir, 'pii-allowlist.json'),
        JSON.stringify([
          {
            file: 'test.txt',
            reason: 'test entry',
            expiresAt: futureDate,
          },
        ]),
      )

      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
      expect(result.stdout).toContain('365-day')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when an entry exceeds the 365-day window', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const suppressionsDir = join(dir, 'suppressions')
      mkdirSync(suppressionsDir)

      const farFuture = new Date()
      farFuture.setDate(farFuture.getDate() + 400)
      const expiredDate = farFuture.toISOString().split('T')[0]

      writeFileSync(
        join(suppressionsDir, 'pii-allowlist.json'),
        JSON.stringify([
          {
            file: 'test.txt',
            reason: 'test entry',
            expiresAt: expiredDate,
          },
        ]),
      )

      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
      expect(result.stderr).toContain('>365')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when an entry exceeds a custom --max-days value', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const suppressionsDir = join(dir, 'suppressions')
      mkdirSync(suppressionsDir)

      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 60)
      const dateStr = futureDate.toISOString().split('T')[0]

      writeFileSync(
        join(suppressionsDir, 'pii-allowlist.json'),
        JSON.stringify([
          {
            file: 'test.txt',
            reason: 'test entry',
            expiresAt: dateStr,
          },
        ]),
      )

      const result = run(dir, 30) // max 30 days, entry is 60 days out
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
      expect(result.stderr).toContain('>30')
    } finally {
      cleanup()
    }
  })

  it('accepts entries with "until" field as alias for expiresAt', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const suppressionsDir = join(dir, 'suppressions')
      mkdirSync(suppressionsDir)

      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const futureDate = tomorrow.toISOString().split('T')[0]

      writeFileSync(
        join(suppressionsDir, 'inline-suppressions.json'),
        JSON.stringify([
          {
            file: 'test.txt',
            reason: 'test entry',
            until: futureDate,
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

  it('skips entries with no expiresAt or until field', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const suppressionsDir = join(dir, 'suppressions')
      mkdirSync(suppressionsDir)

      writeFileSync(
        join(suppressionsDir, 'pii-allowlist.json'),
        JSON.stringify([
          {
            file: 'test.txt',
            reason: 'permanent entry (no expiry)',
          },
        ]),
      )

      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('0 suppression(s)')
    } finally {
      cleanup()
    }
  })

  it('skips entries with invalid date strings', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const suppressionsDir = join(dir, 'suppressions')
      mkdirSync(suppressionsDir)

      writeFileSync(
        join(suppressionsDir, 'pii-allowlist.json'),
        JSON.stringify([
          {
            file: 'test.txt',
            reason: 'test',
            expiresAt: 'not-a-date',
          },
        ]),
      )

      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
      // The entry is counted (checked) but skipped on the NaN date guard, so it
      // never registers as a violation — exit 0 with the entry tallied.
      expect(result.stdout).toContain('1 suppression(s)')
    } finally {
      cleanup()
    }
  })

  it('checks both pii-allowlist.json and inline-suppressions.json', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const suppressionsDir = join(dir, 'suppressions')
      mkdirSync(suppressionsDir)

      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const futureDate = tomorrow.toISOString().split('T')[0]

      writeFileSync(
        join(suppressionsDir, 'pii-allowlist.json'),
        JSON.stringify([
          {
            file: 'test1.txt',
            reason: 'test',
            expiresAt: futureDate,
          },
        ]),
      )

      writeFileSync(
        join(suppressionsDir, 'inline-suppressions.json'),
        JSON.stringify([
          {
            file: 'test2.txt',
            reason: 'test',
            expiresAt: futureDate,
          },
        ]),
      )

      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('2 suppression(s)')
    } finally {
      cleanup()
    }
  })
})
