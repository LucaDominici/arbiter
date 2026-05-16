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
