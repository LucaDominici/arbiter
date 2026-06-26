// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { runReport, resolveRunId, __internal } from '../../src/commands/report.js'

let testDir: string
let logsDir: string
let reportsDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'report-'))
  logsDir = join(testDir, 'logs')
  reportsDir = join(testDir, 'reports')
  mkdirSync(logsDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function seedRun(runId: string, files: Record<string, string>): string {
  const dir = join(logsDir, runId)
  mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

describe('resolveRunId', () => {
  it('picks the most recently modified run dir when no runId given', () => {
    const a = seedRun('a', { 'x.txt': 'A' })
    seedRun('b', { 'x.txt': 'B' })
    utimesSync(a, 1000, 1000)
    utimesSync(join(logsDir, 'b'), 2000, 2000)
    expect(resolveRunId(logsDir)).toBe('b')
  })

  it('returns the requested runId when provided', () => {
    seedRun('a', { 'x.txt': 'A' })
    expect(resolveRunId(logsDir, 'a')).toBe('a')
  })

  it('throws when no runs exist', () => {
    expect(() => resolveRunId(logsDir)).toThrow(/No replay logs found/)
  })
})

describe('collectSafeFiles', () => {
  it('lists regular files in sorted order', () => {
    const dir = seedRun('a', { 'b.txt': '1', 'a.txt': '2', 'sub/c.txt': '3' })
    const r = __internal.collectSafeFiles(dir)
    expect(r.files).toEqual(['a.txt', 'b.txt', join('sub', 'c.txt')])
    expect(r.rejected).toEqual([])
  })

  // @Security:S002 — symlinks in the run dir must never be followed when
  // bundling, otherwise `arbiter report` could exfiltrate arbitrary files
  // outside `~/.arbiter/logs/<runId>/` (e.g., /etc/shadow).
  it('rejects symlinks (S002 mitigation)', () => {
    const dir = seedRun('a', { 'real.txt': 'safe' })
    const evilTarget = join(testDir, 'secret.txt')
    writeFileSync(evilTarget, 'leak')
    symlinkSync(evilTarget, join(dir, 'link.txt'))
    const r = __internal.collectSafeFiles(dir)
    expect(r.files).toEqual(['real.txt'])
    expect(r.rejected).toEqual(['link.txt'])
  })
})

describe('runReport', () => {
  it('--print-only writes manifest and returns null bundlePath', async () => {
    seedRun('p1', { 'command.txt': 'arbiter doctor', 'env.json': '{}' })
    const result = await runReport({
      runId: 'p1',
      logsDir,
      reportsDir,
      printOnly: true,
    })
    expect(result.bundlePath).toBeNull()
    expect(existsSync(result.manifestPath)).toBe(true)
    const manifest = readFileSync(result.manifestPath, 'utf-8')
    expect(manifest).toContain('command.txt')
    expect(manifest).toContain('env.json')
  })

  it('--auto writes a valid .tar.gz to reportsDir', async () => {
    seedRun('p2', { 'command.txt': 'arbiter doctor\n', 'output.log': 'hello\n' })
    const result = await runReport({
      runId: 'p2',
      logsDir,
      reportsDir,
      auto: true,
    })
    expect(result.bundlePath).toBe(join(reportsDir, 'p2.tar.gz'))
    expect(existsSync(result.bundlePath!)).toBe(true)
    const raw = gunzipSync(readFileSync(result.bundlePath!))
    expect(raw.includes(Buffer.from('command.txt'))).toBe(true)
    expect(raw.includes(Buffer.from('arbiter doctor'))).toBe(true)
  })

  it('default (no auto, no printOnly) invokes editor via runInteractive', async () => {
    seedRun('p4', { 'command.txt': 'arbiter doctor' })
    const result = await runReport({
      runId: 'p4',
      logsDir,
      reportsDir,
      editor: '/usr/bin/true',
    })
    expect(result.bundlePath).toBe(join(reportsDir, 'p4.tar.gz'))
    expect(existsSync(result.bundlePath!)).toBe(true)
  })

  it('throws when editor exits non-zero', async () => {
    seedRun('p5', { 'command.txt': 'arbiter doctor' })
    await expect(
      runReport({ runId: 'p5', logsDir, reportsDir, editor: '/usr/bin/false' }),
    ).rejects.toThrow(/editor.*exited/)
  })

  it('throws when requested runId does not exist', async () => {
    await expect(
      runReport({ runId: 'nonexistent', logsDir, reportsDir, auto: true }),
    ).rejects.toThrow(/run directory does not exist/)
  })

  // #1534: the tar writer must stream entries lazily and respect backpressure,
  // never buffering the whole archive in memory.
  it('streams tar entries lazily through a backpressuring sink', async () => {
    const seeds: Record<string, string> = {}
    for (let i = 0; i < 20; i++) seeds[`f${i}.bin`] = 'x'.repeat(64 * 1024)
    const runDir = seedRun('bp', seeds)
    const files = __internal.collectSafeFiles(runDir).files

    let produced = 0
    function* counted(): Generator<Buffer> {
      for (const chunk of __internal.tarEntries(runDir, files)) {
        produced++
        yield chunk
      }
    }

    let consumed = 0
    let maxAhead = 0
    const slowSink = new Writable({
      highWaterMark: 1,
      write(_chunk, _enc, cb) {
        consumed++
        maxAhead = Math.max(maxAhead, produced - consumed)
        // Simulate a slow disk so the source must wait on backpressure.
        setImmediate(cb)
      },
    })

    await pipeline(Readable.from(counted()), slowSink)

    // The archive is dozens of chunks (20 files × header/body/pad + trailer).
    expect(produced).toBeGreaterThan(40)
    // Backpressure respected: the source never races the full archive ahead of
    // the sink — it stays within the stream's small buffer window.
    expect(maxAhead).toBeLessThan(produced)
  })

  it('tarEntries produces a gzip-roundtrippable archive for large multi-chunk files', async () => {
    const big = 'A'.repeat(200 * 1024)
    seedRun('big', { 'log1.txt': big, 'log2.txt': 'B'.repeat(100 * 1024) })
    const result = await runReport({ runId: 'big', logsDir, reportsDir, auto: true })
    const raw = gunzipSync(readFileSync(result.bundlePath!))
    expect(raw.includes(Buffer.from('log1.txt'))).toBe(true)
    expect(raw.includes(Buffer.from(big))).toBe(true)
  })

  it('symlink in run dir is excluded from bundle', async () => {
    const runDir = seedRun('p3', { 'safe.txt': 'safe' })
    const outside = join(testDir, 'OUTSIDE_SECRET.txt')
    writeFileSync(outside, 'leak-value')
    symlinkSync(outside, join(runDir, 'leaky.txt'))
    const result = await runReport({
      runId: 'p3',
      logsDir,
      reportsDir,
      auto: true,
    })
    const raw = gunzipSync(readFileSync(result.bundlePath!))
    expect(raw.includes(Buffer.from('leak-value'))).toBe(false)
    expect(result.rejected).toContain('leaky.txt')
  })
})

// #1571: the ustar header guard validated the entry name in UTF-16 code units but
// wrote it as UTF-8 bytes — the two disagree for any non-ASCII path, silently
// truncating multi-byte names and over-strictly aborting legitimately deep paths.
describe('makeTarHeader / splitUstarName (#1571)', () => {
  // Read the full path back out of a 512-byte ustar header (prefix + '/' + name).
  function readUstarPath(header: Buffer): string {
    const readField = (off: number, len: number): string => {
      const slice = header.subarray(off, off + len)
      const nul = slice.indexOf(0)
      return slice.toString('utf-8', 0, nul === -1 ? len : nul)
    }
    const name = readField(0, 100)
    const prefix = readField(345, 155)
    return prefix.length > 0 ? `${prefix}/${name}` : name
  }

  it('round-trips a multi-byte (CJK) filename via UTF-8 bytes without truncation', () => {
    // 30 CJK chars = 90 UTF-8 bytes: fits the 100-byte name field exactly, but a
    // UTF-16-length check (30) vs a UTF-8 write would never reveal a near-limit case.
    const name = '日'.repeat(30) + '.log'
    const header = __internal.makeTarHeader(name, 10)
    expect(readUstarPath(header)).toBe(name)
  })

  it('splits a deep ASCII path into the ustar prefix field instead of aborting', () => {
    // > 100 bytes total, every component small → must bundle via prefix, not throw.
    const name = Array.from({ length: 30 }, (_, i) => `dir${i}`).join('/') + '/file.txt'
    expect(Buffer.byteLength(name, 'utf8')).toBeGreaterThan(100)
    const split = __internal.splitUstarName(name)
    expect(Buffer.byteLength(split.name, 'utf8')).toBeLessThanOrEqual(100)
    expect(Buffer.byteLength(split.prefix, 'utf8')).toBeLessThanOrEqual(155)
    const header = __internal.makeTarHeader(name, 5)
    expect(readUstarPath(header)).toBe(name)
  })

  it('throws (no silent truncation) when a single component exceeds 100 UTF-8 bytes', () => {
    // 60 CJK chars = 180 UTF-8 bytes, no separator → unrepresentable in ustar. The
    // OLD guard (name.length = 60 ≤ 100) passed and silently truncated to 100 bytes.
    const name = '漢'.repeat(60) + '.log'
    expect(name.length).toBeLessThanOrEqual(100)
    expect(Buffer.byteLength(name, 'utf8')).toBeGreaterThan(100)
    expect(() => __internal.makeTarHeader(name, 1)).toThrow(/too long/)
  })

  it('produces a 512-byte header with a correct ustar checksum', () => {
    const header = __internal.makeTarHeader('logs/run/output.log', 42)
    expect(header.length).toBe(512)
    // Recompute the checksum with the field treated as 8 spaces, per ustar spec.
    let sum = 0
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : (header[i] ?? 0)
    const stored = parseInt(header.subarray(148, 154).toString('utf-8').trim(), 8)
    expect(stored).toBe(sum)
  })
})
