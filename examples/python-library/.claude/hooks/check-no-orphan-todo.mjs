#!/usr/bin/env node
// Arbiter hook: block orphan TODO comments (INV-21)
// Fires on: PostToolUse → Edit|Write
import { readFileSync, existsSync } from 'node:fs'
import { extname } from 'node:path'
import { resolveToolInputPath } from './lib.mjs'

// Match // TODO or /* TODO or * TODO (in comment context), but NOT TODO(#NNN).
// A bare \bTODO\b regex with no comment-context guard false-positives on
// TODO-as-data/prose (e.g. a description string documenting the TODO(#NNN) format).
const ORPHAN_TODO = /(?:\/\/|\/\*|\*)\s*TODO(?!\s*\(#\d+\))/
// Only scan source-file extensions (allowlist, not blocklist) — prose files like
// .md are out of scope so mentioning "TODO" in docs never trips this hook.
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js'])

const file = resolveToolInputPath()
if (!file || !existsSync(file)) process.exit(0)

if (!EXTENSIONS.has(extname(file))) process.exit(0)

let content
try {
  content = readFileSync(file, 'utf-8')
} catch {
  process.exit(0)
}

// Find TODOs without task IDs like TODO(#123), in comment context only.
const offending = content
  .split('\n')
  .flatMap((line, i) => (ORPHAN_TODO.test(line) ? [`${i + 1}: ${line.trim()}`] : []))

if (offending.length > 0) {
  process.stderr.write(
    `[arbiter] INV-21: Orphan TODO found in ${file} (must reference task ID like TODO(#123)):\n`,
  )
  offending.slice(0, 3).forEach((l) => process.stderr.write(`  ${l}\n`))
  process.stderr.write(`[arbiter] Run \`arbiter explain INV-21\` for details.\n`)
  // Exit 2 feeds the violation back to the agent for a PostToolUse guard (#1631).
  process.exit(2)
}
