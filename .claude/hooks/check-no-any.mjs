#!/usr/bin/env node
// Arbiter hook: block explicit 'any' types in TypeScript (INV-04)
// Fires on: PostToolUse → Edit|Write
import { readFileSync, existsSync } from 'node:fs'
import { findInlineSuppression } from './lib.mjs'

const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? ''
if (!file || !existsSync(file)) process.exit(0)
if (!file.endsWith('.ts') && !file.endsWith('.tsx')) process.exit(0)

// Only enforce on files within this repo
const repoRoot = process.cwd()
if (!file.startsWith(repoRoot)) process.exit(0)

let content
try {
  content = readFileSync(file, 'utf-8')
} catch {
  process.exit(0)
}

const lines = content.split('\n')
const offending = lines.flatMap((line, i) => {
  if (!/:\s*any\b/.test(line)) return []
  if (findInlineSuppression(content, i, 'INV-04')) return []
  return [`${i + 1}: ${line.trim()}`]
})

if (offending.length > 0) {
  process.stderr.write(`[arbiter] INV-04: No 'any' type allowed in ${file}:\n`)
  offending.slice(0, 3).forEach((l) => process.stderr.write(`  ${l}\n`))
  process.stderr.write(`[arbiter] Run \`arbiter explain INV-04\` for details.\n`)
  process.exit(1)
}
