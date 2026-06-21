#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// PreToolUse(Edit|Write): load .claude/memory-impl.md when edited file matches globs.
// Prints memory body to stdout so Claude sees project-specific gotchas before editing.
// Never blocks editing — exits 0 on all error paths.
import { readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { minimatch } from 'minimatch'
import { resolveToolInputPath } from './lib.mjs'

const MEMORY_FILE = join(process.cwd(), '.claude', 'memory-impl.md')
const MAX_BODY_BYTES = 4096
const TRUNCATION_MARKER = '\n... [memory truncated at 4KB] ...\n'

const filePath = resolveToolInputPath()
if (!filePath) process.exit(0)

if (!existsSync(MEMORY_FILE)) process.exit(0)

let raw
try {
  raw = readFileSync(MEMORY_FILE, 'utf-8')
} catch {
  process.exit(0)
}

// Parse YAML frontmatter: split on first --- block
const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/s)
if (!fmMatch) {
  process.stderr.write(
    '[pre-edit-load-memory] warn: no frontmatter found in memory-impl.md — skip\n',
  )
  process.exit(0)
}

const [, frontmatter, body] = fmMatch

// Parse globs from frontmatter (simple YAML list parse — no full YAML parser needed)
let globs
try {
  const globsMatch = frontmatter.match(/^globs:\s*\n((?:\s+-.+\n?)*)/m)
  if (!globsMatch) throw new Error('globs key missing')
  globs = globsMatch[1]
    .split('\n')
    .map((l) => l.replace(/^\s+-\s*["']?(.+?)["']?\s*$/, '$1'))
    .filter(Boolean)
  if (globs.length === 0) throw new Error('globs list empty')
} catch (e) {
  process.stderr.write(
    `[pre-edit-load-memory] warn: parse error in memory-impl.md frontmatter — skip (${e.message})\n`,
  )
  process.exit(0)
}

// Match file path against globs.
// Claude Code passes absolute paths; globs are relative to repo root.
// Try: (1) relative from cwd, (2) all path suffixes (fallback for mismatched cwd).
function pathMatchesGlobs(fp, gs) {
  const opts = { matchBase: false, dot: true }
  const rel = relative(process.cwd(), fp)
  if (!rel.startsWith('..') && gs.some((g) => minimatch(rel, g, opts))) return true
  const parts = fp.split('/').filter(Boolean)
  for (let i = 0; i < parts.length; i++) {
    const suffix = parts.slice(i).join('/')
    if (gs.some((g) => minimatch(suffix, g, opts))) return true
  }
  return false
}

if (!pathMatchesGlobs(filePath, globs)) process.exit(0)

// Emit body with 4KB cap
const bodyTrimmed = body.trimEnd()
const bodyBytes = Buffer.byteLength(bodyTrimmed, 'utf-8')
if (bodyBytes > MAX_BODY_BYTES) {
  const truncated = Buffer.from(bodyTrimmed).subarray(0, MAX_BODY_BYTES).toString('utf-8')
  process.stdout.write(truncated + TRUNCATION_MARKER)
} else {
  process.stdout.write(bodyTrimmed + '\n')
}
