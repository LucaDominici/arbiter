import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { appendEvidenceLine, type EvidenceEntry } from '../../src/utils/evidence-log.js'

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'evidence-log-test-'))
}

describe('appendEvidenceLine', () => {
  let dir: string

  beforeEach(() => {
    dir = makeTempDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates .evidence/cmd-log.jsonl with a valid JSONL line', () => {
    const entry: EvidenceEntry = {
      ts: '2026-05-11T19:32:00.000Z',
      cmd: 'init',
      args: ['--level', 'L2'],
      exit: 0,
      durationMs: 1234,
      headSha: 'abc1234',
    }
    appendEvidenceLine(entry, { dir })
    const logPath = join(dir, '.evidence', 'cmd-log.jsonl')
    expect(existsSync(logPath)).toBe(true)
    const content = readFileSync(logPath, 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]!) as EvidenceEntry
    expect(parsed.ts).toBe('2026-05-11T19:32:00.000Z')
    expect(parsed.cmd).toBe('init')
    expect(parsed.args).toEqual(['--level', 'L2'])
    expect(parsed.exit).toBe(0)
    expect(parsed.durationMs).toBe(1234)
    expect(parsed.headSha).toBe('abc1234')
  })

  it('appends multiple lines correctly', () => {
    const base: EvidenceEntry = {
      ts: '2026-05-11T19:00:00.000Z',
      cmd: 'init',
      args: [],
      exit: 0,
      durationMs: 100,
      headSha: 'aaa',
    }
    appendEvidenceLine({ ...base, cmd: 'init' }, { dir })
    appendEvidenceLine({ ...base, cmd: 'update' }, { dir })
    appendEvidenceLine({ ...base, cmd: 'verify' }, { dir })
    const logPath = join(dir, '.evidence', 'cmd-log.jsonl')
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(3)
    expect((JSON.parse(lines[0]!) as EvidenceEntry).cmd).toBe('init')
    expect((JSON.parse(lines[1]!) as EvidenceEntry).cmd).toBe('update')
    expect((JSON.parse(lines[2]!) as EvidenceEntry).cmd).toBe('verify')
  })

  it('creates .evidence directory if it does not exist', () => {
    const subDir = join(dir, 'project')
    mkdirSync(subDir)
    const entry: EvidenceEntry = {
      ts: '2026-05-11T20:00:00.000Z',
      cmd: 'diff',
      args: [],
      exit: 0,
      durationMs: 50,
      headSha: 'bbb',
    }
    appendEvidenceLine(entry, { dir: subDir })
    expect(existsSync(join(subDir, '.evidence', 'cmd-log.jsonl'))).toBe(true)
  })

  it('rotates log when file size exceeds maxBytes', () => {
    const evidenceDir = join(dir, '.evidence')
    mkdirSync(evidenceDir, { recursive: true })
    const logPath = join(evidenceDir, 'cmd-log.jsonl')
    const backupPath = join(evidenceDir, 'cmd-log.jsonl.1')
    // Pre-fill with content that exceeds 10 MB
    const bigContent = 'x'.repeat(10 * 1024 * 1024 + 1)
    writeFileSync(logPath, bigContent)

    const newEntry: EvidenceEntry = {
      ts: '2026-05-11T21:00:00.000Z',
      cmd: 'verify',
      args: [],
      exit: 0,
      durationMs: 77,
      headSha: 'ccc',
    }
    appendEvidenceLine(newEntry, { dir, maxBytes: 10 * 1024 * 1024 })

    expect(existsSync(backupPath)).toBe(true)
    // Backup should have the old large content
    expect(readFileSync(backupPath, 'utf-8')).toBe(bigContent)
    // Main file should contain only the new line
    const newContent = readFileSync(logPath, 'utf-8').trim()
    const parsed = JSON.parse(newContent) as EvidenceEntry
    expect(parsed.cmd).toBe('verify')
    expect(parsed.headSha).toBe('ccc')
  })

  it('rotation overwrites existing .1 backup (no .2 accumulation)', () => {
    const evidenceDir = join(dir, '.evidence')
    mkdirSync(evidenceDir, { recursive: true })
    const logPath = join(evidenceDir, 'cmd-log.jsonl')
    const backupPath = join(evidenceDir, 'cmd-log.jsonl.1')
    const bigContent = 'y'.repeat(10 * 1024 * 1024 + 1)
    writeFileSync(logPath, bigContent)
    writeFileSync(backupPath, 'old-backup-content')

    const entry: EvidenceEntry = {
      ts: '2026-05-11T22:00:00.000Z',
      cmd: 'init',
      args: [],
      exit: 0,
      durationMs: 10,
      headSha: 'ddd',
    }
    appendEvidenceLine(entry, { dir, maxBytes: 10 * 1024 * 1024 })

    // old-backup-content must be gone; new backup must be the big content
    expect(readFileSync(backupPath, 'utf-8')).toBe(bigContent)
    expect(existsSync(join(evidenceDir, 'cmd-log.jsonl.2'))).toBe(false)
  })

  it('does not throw on a bad dir path (resilience)', () => {
    const entry: EvidenceEntry = {
      ts: '2026-05-11T23:00:00.000Z',
      cmd: 'init',
      args: [],
      exit: 1,
      durationMs: 5,
      headSha: 'eee',
    }
    expect(() =>
      appendEvidenceLine(entry, { dir: '/nonexistent-path-xyz-9999/project' }),
    ).not.toThrow()
  })

  it('respects noEvidence option — does not create any file', () => {
    const entry: EvidenceEntry = {
      ts: '2026-05-11T19:00:00.000Z',
      cmd: 'init',
      args: [],
      exit: 0,
      durationMs: 10,
      headSha: 'fff',
    }
    appendEvidenceLine(entry, { dir, noEvidence: true })
    expect(existsSync(join(dir, '.evidence', 'cmd-log.jsonl'))).toBe(false)
    expect(existsSync(join(dir, '.evidence'))).toBe(false)
  })

  it('uses default maxBytes of 10MB when not specified', () => {
    const evidenceDir = join(dir, '.evidence')
    mkdirSync(evidenceDir, { recursive: true })
    const logPath = join(evidenceDir, 'cmd-log.jsonl')
    // File just below 10MB - should NOT rotate
    const belowLimit = 'z'.repeat(10 * 1024 * 1024 - 1)
    writeFileSync(logPath, belowLimit)

    const entry: EvidenceEntry = {
      ts: '2026-05-11T20:00:00.000Z',
      cmd: 'update',
      args: [],
      exit: 0,
      durationMs: 20,
      headSha: 'ggg',
    }
    appendEvidenceLine(entry, { dir })
    // Should NOT have rotated
    expect(existsSync(join(evidenceDir, 'cmd-log.jsonl.1'))).toBe(false)
    // File size should be larger than before (appended)
    const content = readFileSync(logPath, 'utf-8')
    expect(content.startsWith('z')).toBe(true)
    expect(content.endsWith('\n')).toBe(true)
  })
})
