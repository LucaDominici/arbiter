#!/usr/bin/env node
// Arbiter hook: block orphan TODO comments (INV-21)
// Fires on: PostToolUse → Edit|Write
import { readFileSync, existsSync } from 'node:fs'
import { findInlineSuppression, resolveToolInputPath } from './lib.mjs'

const file = resolveToolInputPath()
if (!file || !existsSync(file)) process.exit(0)

// Only enforce on files within this repo
const repoRoot = process.cwd()
if (!file.startsWith(repoRoot)) process.exit(0)

// Skip binary files and lock files
const SKIP_EXTENSIONS = [
  '.lock',
  '.lockb',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.wasm',
  '.bin',
]
if (SKIP_EXTENSIONS.some((ext) => file.endsWith(ext))) process.exit(0)

let content
try {
  content = readFileSync(file, 'utf-8')
} catch {
  process.exit(0)
}

// Find TODOs without task IDs like TODO(#123)
const lines = content.split('\n')
const offending = lines.flatMap((line, i) => {
  if (!/\bTODO\b/.test(line) || /\bTODO\b.*\(#\d+\)/.test(line)) return []
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
