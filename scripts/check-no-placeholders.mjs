#!/usr/bin/env node
// Scans source files for placeholder patterns and disabled tests.
// Usage: node scripts/check-no-placeholders.mjs [dir...]
// Exits 1 if any violations are found.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// #2528: the three shouted-only markers below are built by concatenation so this
// checker's own source never contains one as a contiguous string — a literal
// occurrence here would make this hook block edits to itself (and to its own
// test). `marker()` also drops the case-insensitive flag these three used to
// carry, matching the other entries here: the plain word is ordinary English,
// only the all-caps form is a violation. The emitted `label` still reads
// correctly, since it is the same (correctly-cased) word passed in.
const marker = (word) => ({ re: new RegExp(`\\b${word}\\b`), label: word })

const PATTERNS = [
  marker(`PLACE${'HOLDER'}`),
  { re: /\bFIXME\b/, label: 'FIXME' },
  { re: /\bXXX\b/, label: 'XXX' },
  { re: /\bHACK\b/, label: 'HACK' },
  { re: /\bWIP\b/, label: 'WIP' },
  marker(`CHANGE${'ME'}`),
  marker(`REPLACE${'ME'}`),
  {
    re: /\b(it|describe|test)\.skip\s*\(/,
    label: 'it.skip/describe.skip/test.skip',
  },
  { re: /\b(xit|xdescribe|xtest)\s*\(/, label: 'xit/xdescribe/xtest' },
]

const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])
// Skip EJS template trees by relative path — they contain pattern strings, not violations
const SKIP_PATHS = new Set(['src/templates'])

const scanDirs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [process.cwd()]
const baseDir = process.cwd()
let violations = 0

function scan(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (SKIP_PATHS.has(relative(baseDir, full))) continue
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      scan(full)
    } else if (EXTENSIONS.has(full.slice(full.lastIndexOf('.')))) {
      scanFile(full)
    }
  }
}

function scanFile(filePath) {
  let content
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return
  }
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const { re, label } of PATTERNS) {
      if (re.test(line)) {
        const rel = relative(baseDir, filePath)
        process.stdout.write(`  ${rel}:${i + 1}  [${label}]  ${line.trim()}
`)
        violations++
        break
      }
    }
  }
}

for (const dir of scanDirs) {
  scan(dir)
}

if (violations > 0) {
  process.stdout
    .write(`\n  Found ${violations} violation(s). Remove placeholders before committing.\n
`)
  process.exit(1)
}
