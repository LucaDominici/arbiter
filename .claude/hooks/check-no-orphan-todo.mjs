#!/usr/bin/env node
// Arbiter hook: block orphan TODO comments (INV-21)
// Fires on: PostToolUse → Edit|Write
import { readFileSync, existsSync } from 'node:fs'
import { extname } from 'node:path'
import { addedLinesVsHEAD, findInlineSuppression, resolveToolInputPath } from './lib.mjs'
// Reuse the gate's reference matcher/extension-allowlist (#1796/#1799/#1778): a bare
// \bTODO\b regex with no comment-context guard false-positives on TODO-as-data/prose
// (catalog.ts description strings, docs prose) and on non-source files (.md).
import { ORPHAN_TODO, EXTENSIONS } from '../../scripts/check-no-orphan-todo.mjs'

const file = resolveToolInputPath()
if (!file || !existsSync(file)) process.exit(0)

// Only enforce on files within this repo
const repoRoot = process.cwd()
if (!file.startsWith(repoRoot)) process.exit(0)

// Only enforce on source-file extensions the gate itself scans (allowlist, not blocklist).
if (!EXTENSIONS.has(extname(file))) process.exit(0)

let content
try {
  content = readFileSync(file, 'utf-8')
} catch {
  process.stderr.write('[arbiter] ERROR: cannot read applicable source file\n')
  process.exit(2)
}

// #2539: scan only the lines THIS edit added, not the whole file — a
// pre-existing orphan-TODO-shaped line on an untouched line (this checker's
// own doc comment illustrating the pattern, or its own regex definition) must
// not block an unrelated edit elsewhere in the same file. Untracked files and
// git errors fail OPEN to the whole-file scan (never skip).
const { tracked, added } = addedLinesVsHEAD(file)
const scanLines = tracked
  ? added.map(({ line, content: text }) => [line - 1, text])
  : content.split('\n').map((text, index) => [index, text])

// Find TODOs without task IDs like TODO(#123), in comment context only.
const offending = scanLines.flatMap(([i, line]) => {
  if (!ORPHAN_TODO.test(line)) return []
  if (findInlineSuppression(content, i, 'INV-21')) return []
  return [`${i + 1}: ${line.trim()}`]
})

if (offending.length > 0) {
  process.stderr.write(
    `[arbiter] INV-21: Orphan TODO found in ${file} (must reference task ID like TODO(#123)):\n`,
  )
  offending.slice(0, 3).forEach((l) => process.stderr.write(`  ${l}\n`))
  process.stderr.write(`[arbiter] Run \`arbiter explain INV-21\` for details.\n`)
  // Exit 2 feeds the violation back to the agent for a PostToolUse guard (#1631).
  process.exit(2)
}
