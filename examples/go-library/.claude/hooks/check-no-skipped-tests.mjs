#!/usr/bin/env node
// Arbiter hook: block skipped/disabled tests (NI-11)
// Fires on: PostToolUse → Edit|Write
import { readFileSync, existsSync } from 'node:fs'
import { addedLinesVsHEAD, resolveToolInputPath } from './lib.mjs'

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

// #2539: scan only the lines THIS edit added, not the whole file — a
// pre-existing skip-shaped line on an untouched line (this checker's own
// doc comment naming the aliases it looks for, or a fixture that deliberately
// plants one as test data) must not block an unrelated edit elsewhere in the
// same file. Untracked files and git errors fail OPEN to the whole-file scan
// (never skip) — see addedLinesVsHEAD's doc comment.
const { tracked, added } = addedLinesVsHEAD(file)
const scanLines = tracked
  ? added.map(({ line, content: text }) => [line - 1, text])
  : content.split('\n').map((text, index) => [index, text])
const ext = file.slice(file.lastIndexOf('.'))

/** @param {RegExp} re @param {string} label */
function findOffending(re, label) {
  return scanLines.flatMap(([i, line]) => (re.test(line) ? [`${i + 1}: [${label}] ${line.trim()}`] : []))
}

const offending = []

// JS / TS — skip/only calls, plus the x-prefixed aliases (xit, xtest, xdescribe)
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
