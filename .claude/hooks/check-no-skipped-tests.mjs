#!/usr/bin/env node
// Arbiter hook: block skipped / disabled tests across all languages (NI-11)
// Fires on: PostToolUse → Edit|Write
import { readFileSync, existsSync } from 'node:fs'

const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? ''
if (!file || !existsSync(file)) process.exit(0)

const SKIP_EXTENSIONS = ['.lock', '.lockb', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.wasm']
if (SKIP_EXTENSIONS.some((ext) => file.endsWith(ext))) process.exit(0)

let content
try {
  content = readFileSync(file, 'utf-8')
} catch {
  process.exit(0)
}

// Language-specific skip annotations not already covered by check-no-placeholders.mjs
const PATTERNS = [
  { re: /@Disabled\b/, label: '@Disabled (JUnit 5)' },
  { re: /@Ignore\b/, label: '@Ignore (JUnit 4)' },
  { re: /\bpytest\.mark\.skip\b/, label: 'pytest.mark.skip' },
  { re: /\bpytest\.mark\.xfail\b/, label: 'pytest.mark.xfail' },
  { re: /\bt\.Skip\s*\(/, label: 't.Skip( (Go)' },
  { re: /\bskip\.test\s*\(/, label: 'skip.test(' },
]

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
  process.stderr.write(`[arbiter] NI-11: skipped/disabled test pattern(s) in ${file}:\n`)
  for (const msg of found) process.stderr.write(`${msg}\n`)
  process.stderr.write('[arbiter] Remove the skip annotation or delete the test entirely.\n')
  process.exit(1)
}
