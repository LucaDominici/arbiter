#!/usr/bin/env node
// Claude hook: blocks placeholder patterns in files being written/edited.
// Fires on: PostToolUse → Edit|Write
import { readFileSync, existsSync } from 'node:fs'
import { extname } from 'node:path'
import { resolveToolInputPath } from './lib.mjs'

// Only scan source-file extensions (allowlist, not blocklist) — prose files like
// .md are out of scope so mentioning "[PLACEHOLDER]" in docs prose never trips this
// hook (#1778).
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js'])

const PATTERNS = [
  { re: /\bPLACEHOLDER\b/i, label: 'PLACEHOLDER' },
  { re: /\bFIXME\b/, label: 'FIXME' },
  { re: /\bXXX\b/, label: 'XXX' },
  { re: /\bHACK\b/, label: 'HACK' },
  { re: /\bWIP\b/, label: 'WIP' },
  { re: /\bCHANGEME\b/i, label: 'CHANGEME' },
  { re: /\bREPLACEME\b/i, label: 'REPLACEME' },
  {
    re: /\b(it|describe|test)\.skip\s*\(/,
    label: 'it.skip/describe.skip/test.skip',
  },
  { re: /\b(xit|xdescribe|xtest)\s*\(/, label: 'xit/xdescribe/xtest' },
]

const file = resolveToolInputPath()
if (!file || !existsSync(file)) process.exit(0)

if (!EXTENSIONS.has(extname(file))) process.exit(0)

let content
try {
  content = readFileSync(file, 'utf-8')
} catch {
  process.exit(0)
}

const lines = content.split('\n')
const found = []

for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  for (const { re, label } of PATTERNS) {
    if (re.test(line)) {
      found.push(`  line ${i + 1}: [${label}]  ${line.trim()}`)
      break
    }
  }
}

if (found.length > 0) {
  console.error(`Placeholder patterns found in ${file}:`)
  for (const msg of found) console.error(msg)
  console.error('\nRemove placeholder/WIP/disabled-test patterns before saving.')
  // Exit 2 feeds the violation back to the agent for a PostToolUse guard (#1631).
  process.exit(2)
}
