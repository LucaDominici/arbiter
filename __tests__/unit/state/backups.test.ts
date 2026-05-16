// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listBackups, rotateBackup, DEFAULT_BACKUP_CAP } from '../../../src/state/backups.js'

describe('rotateBackup', () => {
  let dir: string
  let snap: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-backup-'))
    snap = join(dir, '.arbiter-generated.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('returns null when source file missing (fresh project)', () => {
    expect(rotateBackup(snap)).toBeNull()
  })

  it('creates a .bak.<ts> copy when source exists', () => {
    writeFileSync(snap, '{"v":1}')
    const bak = rotateBackup(snap)
    expect(bak).not.toBeNull()
    expect(existsSync(bak as string)).toBe(true)
    expect(readFileSync(bak as string, 'utf-8')).toBe('{"v":1}')
  })

  it('caps backups at the supplied cap (oldest pruned)', () => {
    writeFileSync(snap, 'seed')
    // Use unique mtimes so listBackups sort is deterministic
    for (let i = 0; i < 5; i++) {
      const b = `${snap}.bak.2026-01-0${i + 1}T00-00-00-000Z`
      writeFileSync(b, `b${i}`)
      const t = new Date(2026, 0, i + 1).getTime() / 1000
      utimesSync(b, t, t)
    }
    rotateBackup(snap, { cap: 3 })
    const remaining = listBackups(snap)
    expect(remaining.length).toBe(3)
    // Oldest two pruned — those with the smallest mtime
    for (const r of remaining) {
      expect(r).not.toContain('2026-01-01')
      expect(r).not.toContain('2026-01-02')
    }
  })

  it('default cap is 10', () => {
    expect(DEFAULT_BACKUP_CAP).toBe(10)
  })
})
