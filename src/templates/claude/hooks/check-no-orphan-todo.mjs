#!/usr/bin/env node
// Arbiter hook: block orphan TODO comments (INV-21)
// Fires on: PostToolUse → Edit|Write
import { readFileSync, existsSync } from 'node:fs'

const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? ''
if (!file || !existsSync(file)) process.exit(0)

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
const offending = content
  .split('\n')
  .flatMap((line, i) =>
    /\bTODO\b/.test(line) && !/\bTODO\b.*\(#\d+\)/.test(line) ? [`${i + 1}: ${line.trim()}`] : [],
  )

if (offending.length > 0) {
  process.stderr.write(
    `[arbiter] INV-21: Orphan TODO found in ${file} (must reference task ID like TODO(#123)):\n`,
  )
  offending.slice(0, 3).forEach((l) => process.stderr.write(`  ${l}\n`))
  process.exit(1)
}
