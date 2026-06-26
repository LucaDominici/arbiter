#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// emit-context-slice.mjs (#993) — atomic verbatim CONTEXT_SLICE emitter.
// Extracts a byte-identical line range from one source file and emits a
// self-describing CONTEXT_SLICE block per docs/METHOD/CONTEXT_SLICE_SPEC.md.
//
// Determinism contract: no timestamps, hostnames, PIDs, or env vars in output.
//
// Usage:
//   node scripts/emit-context-slice.mjs --source <path> --lines <start>-<end>
//                                       [--out <path>]

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

function usage() {
  return (
    [
      'Usage: node scripts/emit-context-slice.mjs --source <path> --lines <start>-<end> [--out <path>]',
      '',
      'Options:',
      '  --source  repo-relative path to source file (required)',
      '  --lines   inclusive 1-indexed range, e.g. 3-7 or 5-5 (required)',
      '  --out     write slice to this path instead of stdout (optional)',
      '  -h,--help show this message',
    ].join('\n') + '\n'
  )
}

function parseCli() {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      lines: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    process.stdout.write(usage())
    process.exit(0)
  }

  if (!values.source) {
    process.stderr.write('error: --source is required\n' + usage())
    process.exit(2)
  }
  if (!values.lines) {
    process.stderr.write('error: --lines is required\n' + usage())
    process.exit(2)
  }

  const m = /^(\d+)-(\d+)$/.exec(values.lines)
  if (!m) {
    process.stderr.write(`error: --lines must be <start>-<end>, got: ${values.lines}\n`)
    process.exit(2)
  }

  const start = parseInt(m[1], 10)
  const end = parseInt(m[2], 10)

  if (start < 1 || end < 1) {
    process.stderr.write(`error: --lines bounds must be >= 1, got: ${values.lines}\n`)
    process.exit(2)
  }
  if (end < start) {
    process.stderr.write(`error: --lines end must be >= start, got: ${values.lines}\n`)
    process.exit(2)
  }

  return { source: values.source, start, end, out: values.out }
}

function guardSourcePath(source) {
  if (isAbsolute(source)) {
    process.stderr.write(`error: --source must be repo-relative, got absolute: ${source}\n`)
    process.exit(2)
  }

  const resolved = resolve(REPO_ROOT, source)
  const rel = relative(REPO_ROOT, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    process.stderr.write(`error: --source path traverses outside the repository: ${source}\n`)
    process.exit(2)
  }

  return resolved
}

function readSource(absPath, source) {
  if (!existsSync(absPath)) {
    process.stderr.write(`error: cannot read source file (ENOENT): ${source}\n`)
    process.exit(2)
  }
  try {
    return readFileSync(absPath, 'utf-8')
  } catch (err) {
    process.stderr.write(`error: cannot read source file: ${err.message}\n`)
    process.exit(2)
  }
}

function extractBody(content, start, end, source) {
  // Split on \n. "a\nb\n".split('\n') → ["a","b",""].
  // Trailing empty string signals file has trailing newline.
  const rawLines = content.split('\n')
  const hasTrailingNewline = content.endsWith('\n')
  const logicalLines = hasTrailingNewline ? rawLines.slice(0, -1) : rawLines
  const lineCount = logicalLines.length

  if (end > lineCount) {
    process.stderr.write(
      `error: --lines range ${start}-${end} out of bounds (file has ${lineCount} lines): ${source}\n`,
    )
    process.exit(2)
  }

  const slice = logicalLines.slice(start - 1, end)
  const isLastLineOfFile = end === lineCount
  const appendNewline = !isLastLineOfFile || hasTrailingNewline
  return slice.join('\n') + (appendNewline ? '\n' : '')
}

function buildSlice(source, start, end, body) {
  const lineCount = end - start + 1
  const bodyBytes = Buffer.from(body, 'utf-8')
  const byteCount = bodyBytes.length
  const sha256 = createHash('sha256').update(bodyBytes).digest('hex')

  return [
    '# CONTEXT_SLICE',
    '- spec_version: 1.0.0',
    `- source: ${source}:L${start}-L${end}`,
    `- line_count: ${lineCount}`,
    `- byte_count: ${byteCount}`,
    `- sha256: ${sha256}`,
    '',
    body,
  ].join('\n')
}

try {
  const { source, start, end, out } = parseCli()
  const absPath = guardSourcePath(source)
  const content = readSource(absPath, source)
  const body = extractBody(content, start, end, source)
  const slice = buildSlice(source, start, end, body)

  if (out) {
    const outAbs = resolve(out)
    mkdirSync(dirname(outAbs), { recursive: true })
    writeFileSync(outAbs, slice, 'utf-8')
  } else {
    process.stdout.write(slice)
  }
} catch (err) {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
}
