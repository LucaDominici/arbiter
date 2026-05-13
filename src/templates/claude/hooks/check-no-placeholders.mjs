#!/usr/bin/env node
// Claude hook: blocks placeholder patterns in files being written/edited.
// Fires on: PostToolUse → Edit|Write
import { readFileSync, existsSync } from 'node:fs'

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

const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? ''
if (!file || !existsSync(file)) process.exit(0)

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
  process.exit(1)
}
