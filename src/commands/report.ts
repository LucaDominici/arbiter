// SPDX-License-Identifier: Apache-2.0
// `arbiter report` — bundle a replay run for bug reports (#639, R1.M5).
//
// Default mode (B): editor preview — write a manifest, spawn $EDITOR so the
// user reviews and trims files before bundling. --auto opt-out skips the editor;
// --print-only emits the manifest path without producing a tarball.

import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createGzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { getLogger } from '../utils/logger.js'
import { runInteractive } from '../utils/run-cli.js'

export interface ReportOptions {
  runId?: string
  logsDir?: string
  reportsDir?: string
  auto?: boolean
  printOnly?: boolean
  editor?: string
}

export interface ReportResult {
  bundlePath: string | null
  manifestPath: string
  files: string[]
  rejected: string[]
}

function defaultLogsDir(): string {
  return join(homedir(), '.arbiter', 'logs')
}

function defaultReportsDir(): string {
  return join(homedir(), '.arbiter', 'reports')
}

export function resolveRunId(logsDir: string, requested?: string): string {
  if (requested !== undefined) return requested
  if (!existsSync(logsDir)) throw new Error(`No replay logs found at ${logsDir}`)
  const candidates = readdirSync(logsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, mtime: statSync(join(logsDir, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  const latest = candidates[0]
  if (!latest) throw new Error(`No replay logs found in ${logsDir}`)
  return latest.name
}

interface CollectResult {
  files: string[]
  rejected: string[]
}

function collectSafeFiles(runDir: string): CollectResult {
  const files: string[] = []
  const rejected: string[] = []
  const realRoot = resolve(runDir)
  walk(realRoot, realRoot, files, rejected)
  files.sort()
  return { files, rejected }
}

function walk(root: string, base: string, files: string[], rejected: string[]): void {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(root, entry.name)
    const rel = full.slice(base.length + 1)
    let stat
    try {
      stat = lstatSync(full)
    } catch {
      rejected.push(rel)
      continue
    }
    if (stat.isSymbolicLink()) {
      rejected.push(rel)
      continue
    }
    if (stat.isDirectory()) {
      walk(full, base, files, rejected)
    } else if (stat.isFile()) {
      files.push(rel)
    } else {
      rejected.push(rel)
    }
  }
}

function writeManifest(runDir: string, files: string[]): string {
  const manifestPath = join(mkdtempSync(join(tmpdir(), 'arbiter-report-')), 'manifest.txt')
  const lines = [
    `# arbiter report manifest`,
    `# run directory: ${runDir}`,
    `# delete a line below to exclude that file from the bundle.`,
    '',
    ...files,
    '',
  ]
  writeFileSync(manifestPath, lines.join('\n'))
  return manifestPath
}

function readManifestFiles(manifestPath: string): string[] {
  return readFileSync(manifestPath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}

function spawnEditor(editor: string, path: string): void {
  const result = runInteractive(editor, [path])
  if (result.exitCode !== 0) {
    throw new Error(`editor ${editor} exited with status ${result.exitCode}`)
  }
}

export async function runReport(opts: ReportOptions = {}): Promise<ReportResult> {
  const logger = getLogger()
  const logsDir = opts.logsDir ?? defaultLogsDir()
  const reportsDir = opts.reportsDir ?? defaultReportsDir()
  const runId = resolveRunId(logsDir, opts.runId)
  const runDir = join(logsDir, runId)
  if (!existsSync(runDir)) throw new Error(`run directory does not exist: ${runDir}`)

  const collected = collectSafeFiles(runDir)
  if (collected.rejected.length > 0) {
    logger.warn('report.rejected_entries', { count: collected.rejected.length })
  }

  const manifestPath = writeManifest(runDir, collected.files)

  if (opts.printOnly === true) {
    return { bundlePath: null, manifestPath, files: collected.files, rejected: collected.rejected }
  }

  let finalFiles = collected.files
  if (opts.auto !== true) {
    const editor = opts.editor ?? process.env.EDITOR ?? process.env.VISUAL ?? 'vi'
    spawnEditor(editor, manifestPath)
    finalFiles = readManifestFiles(manifestPath)
  }

  mkdirSync(reportsDir, { recursive: true })
  const bundlePath = join(reportsDir, `${runId}.tar.gz`)
  await writeTarGz(runDir, finalFiles.sort(), bundlePath)

  return {
    bundlePath,
    manifestPath,
    files: finalFiles,
    rejected: collected.rejected,
  }
}

// ─── Minimal POSIX ustar writer (no external deps) ─────────────────────────

/**
 * Lazily yield the raw tar (ustar) byte stream for `files`. Because this is a
 * generator pulled on demand by `Readable.from`, each file is read only when
 * the downstream gzip/disk side is ready for it — so memory stays bounded to
 * the in-flight chunks instead of accumulating the whole archive (#1534).
 */
function* tarEntries(runDir: string, files: string[]): Generator<Buffer> {
  for (const rel of files) {
    const full = join(runDir, rel)
    let buf: Buffer
    try {
      buf = readFileSync(full)
    } catch {
      continue
    }
    yield makeTarHeader(rel, buf.length)
    yield buf
    const pad = 512 - (buf.length % 512)
    if (pad < 512) yield Buffer.alloc(pad)
  }
  // Two trailing 512-byte zero blocks mark end-of-archive.
  yield Buffer.alloc(1024)
}

async function writeTarGz(runDir: string, files: string[], outPath: string): Promise<void> {
  mkdirSync(dirname(outPath), { recursive: true })
  // `pipeline` wires backpressure end-to-end: the entry generator is paused
  // whenever gzip's writable buffer or the file sink is full.
  await pipeline(Readable.from(tarEntries(runDir, files)), createGzip(), createWriteStream(outPath))
}

function makeTarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512)
  if (name.length > 100) throw new Error(`tar entry name too long: ${name}`)
  header.write(name, 0, 100, 'utf-8')
  writeOctal(header, 100, 8, 0o644)
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  writeOctal(header, 124, 12, size)
  writeOctal(header, 136, 12, Math.floor(Date.now() / 1000))
  header.write('        ', 148, 8, 'utf-8')
  header.write('0', 156, 1, 'utf-8')
  header.write('ustar\0', 257, 6, 'utf-8')
  header.write('00', 263, 2, 'utf-8')
  let checksum = 0
  for (let i = 0; i < 512; i++) checksum += header[i] ?? 0
  writeOctal(header, 148, 7, checksum)
  header.write('\0', 155, 1, 'utf-8')
  return header
}

function writeOctal(buf: Buffer, offset: number, width: number, value: number): void {
  const str = value.toString(8).padStart(width - 1, '0')
  buf.write(str, offset, width - 1, 'utf-8')
  buf.write('\0', offset + width - 1, 1, 'utf-8')
}

// Helpers exported for tests/inspection.
export const __internal = {
  collectSafeFiles,
  resolveRunId,
  writeManifest,
  readManifestFiles,
  tarEntries,
}
