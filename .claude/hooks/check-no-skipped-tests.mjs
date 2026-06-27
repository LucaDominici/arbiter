#!/usr/bin/env node
// Arbiter hook: block skipped/disabled tests (NI-11)
// Fires on: PostToolUse → Edit|Write
import { readFileSync, existsSync } from 'node:fs'
import { resolveToolInputPath } from './lib.mjs'

const file = resolveToolInputPath()
if (!file || !existsSync(file)) process.exit(0)

// Binary / lock files — skip
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

const lines = content.split('\n')
const ext = file.slice(file.lastIndexOf('.'))

/** @param {RegExp} re @param {string} label */
function findOffending(re, label) {
  return lines.flatMap((line, i) => (re.test(line) ? [`${i + 1}: [${label}] ${line.trim()}`] : []))
}

const offending = []

// JS / TS — .skip(), xit(), xtest(), xdescribe()
if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
  offending.push(...findOffending(/\.(skip|only)\s*\(/, '.skip/.only'))
  offending.push(...findOffending(/\b(xit|xtest|xdescribe)\s*\(/, 'xit/xtest/xdescribe'))
}

// Java — @Disabled, @Ignore
if (ext === '.java') {
  offending.push(...findOffending(/@(Disabled|Ignore)\b/, '@Disabled/@Ignore'))
}

// Python — @pytest.mark.skip, @pytest.mark.xfail
if (ext === '.py') {
  offending.push(...findOffending(/@pytest\.mark\.(skip|xfail)\b/, 'pytest.mark.skip/xfail'))
}

// Rust — #[ignore]
if (ext === '.rs') {
  offending.push(...findOffending(/#\[ignore\]/, '#[ignore]'))
}

if (offending.length > 0) {
  process.stderr.write(
    `[arbiter] NI-11: Skipped/disabled test found in ${file} — remove the skip or open a tracking issue:\n`,
  )
  offending.slice(0, 3).forEach((l) => process.stderr.write(`  ${l}\n`))
  // Exit 2 feeds the violation back to the agent for a PostToolUse guard (#1631).
  process.exit(2)
}
