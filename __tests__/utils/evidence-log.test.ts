import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { appendEvidenceLine, type EvidenceEntry } from '../../src/utils/evidence-log.js'

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'evidence-log-test-'))
}

/** List rotated backup files (everything matching cmd-log.jsonl.* in .evidence). */
function listBackups(evidenceDir: string): string[] {
  return readdirSync(evidenceDir)
    .filter((f) => f.startsWith('cmd-log.jsonl.'))
    .sort()
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

  it('rotates log to a uniquely-named backup when file size exceeds maxBytes', () => {
    const evidenceDir = join(dir, '.evidence')
    mkdirSync(evidenceDir, { recursive: true })
    const logPath = join(evidenceDir, 'cmd-log.jsonl')
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

    // Exactly one backup, uniquely named (pid + timestamp), holding the old content.
    const backups = listBackups(evidenceDir)
    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatch(/^cmd-log\.jsonl\.\d+\.\d+\.\d+$/)
    expect(readFileSync(join(evidenceDir, backups[0]!), 'utf-8')).toBe(bigContent)
    // Main file should contain only the new line
    const newContent = readFileSync(logPath, 'utf-8').trim()
    const parsed = JSON.parse(newContent) as EvidenceEntry
    expect(parsed.cmd).toBe('verify')
    expect(parsed.headSha).toBe('ccc')
  })

  it('rotation never clobbers a pre-existing backup (concurrency-safe history)', () => {
    // Two concurrent rotators must not overwrite each other's history. The fix
    // gives each rotation a unique backup name, so a pre-existing backup (here
    // an old fixed-name `cmd-log.jsonl.1`) survives untouched.
    const evidenceDir = join(dir, '.evidence')
    mkdirSync(evidenceDir, { recursive: true })
    const logPath = join(evidenceDir, 'cmd-log.jsonl')
    const priorBackup = join(evidenceDir, 'cmd-log.jsonl.1')
    const bigContent = 'y'.repeat(10 * 1024 * 1024 + 1)
    writeFileSync(logPath, bigContent)
    writeFileSync(priorBackup, 'prior-history-must-survive')

    const entry: EvidenceEntry = {
      ts: '2026-05-11T22:00:00.000Z',
      cmd: 'init',
      args: [],
      exit: 0,
      durationMs: 10,
      headSha: 'ddd',
    }
    appendEvidenceLine(entry, { dir, maxBytes: 10 * 1024 * 1024 })

    // The pre-existing backup must be preserved (NOT clobbered)…
    expect(readFileSync(priorBackup, 'utf-8')).toBe('prior-history-must-survive')
    // …and the new rotation must land in its own distinct backup file.
    const backups = listBackups(evidenceDir)
    const fresh = backups.filter((f) => f !== 'cmd-log.jsonl.1')
    expect(fresh).toHaveLength(1)
    expect(readFileSync(join(evidenceDir, fresh[0]!), 'utf-8')).toBe(bigContent)
  })

  it('loses zero lines under 2-process concurrent rotation (tiny maxBytes)', () => {
    // Regression for #1556: with the old shared try/catch + fixed `.1` name, two
    // arbiter processes crossing the rotation boundary together silently drop
    // lines (rename ENOENT skips the append) and clobber each other's backup.
    // The fix isolates the rename and uses a unique backup suffix, so every line
    // survives across the live log plus every rotated backup.
    const evidenceDir = join(dir, '.evidence')
    mkdirSync(evidenceDir, { recursive: true })

    const require = createRequire(import.meta.url)
    const tsxLoader = require.resolve('tsx/esm')
    const worker = join(__dirname, '../fixtures/evidence-log-race-worker.mjs')
    const modUrl = pathToFileURL(join(__dirname, '../../src/utils/evidence-log.ts')).href
    const perWorker = 400
    const maxBytes = 256 // forces a rotation every few lines → heavy race pressure

    // Launch BOTH workers truly concurrently (shell background + wait) so their
    // rotations actually overlap — a blocking spawnSync per worker would serialize
    // them and never exercise the race.
    const one = (id: string) =>
      `node --import ${JSON.stringify(tsxLoader)} ${JSON.stringify(worker)} ` +
      `${JSON.stringify(modUrl)} ${JSON.stringify(dir)} ${maxBytes} ${perWorker} ${id}`
    const res = spawnSync('sh', ['-c', `${one('A')} & ${one('B')} & wait`], {
      encoding: 'utf-8',
      timeout: 30_000,
    })
    expect(res.status).toBe(0)

    // Collect every JSONL line across the live log AND all rotated backups.
    const seen = new Set<string>()
    let total = 0
    for (const f of [...listBackups(evidenceDir), 'cmd-log.jsonl']) {
      const p = join(evidenceDir, f)
      if (!existsSync(p)) continue
      for (const line of readFileSync(p, 'utf-8').split('\n')) {
        if (!line.trim()) continue
        const entry = JSON.parse(line) as EvidenceEntry
        seen.add(`${entry.args[0]}:${entry.args[1]}`)
        total++
      }
    }

    // Zero line loss: every (worker, index) marker present exactly once.
    expect(seen.size).toBe(2 * perWorker)
    expect(total).toBe(2 * perWorker)
    for (const id of ['A', 'B']) {
      for (let i = 0; i < perWorker; i++) {
        expect(seen.has(`${id}:${i}`)).toBe(true)
      }
    }
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
