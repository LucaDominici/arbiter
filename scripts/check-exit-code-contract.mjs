#!/usr/bin/env node
// Scans scripts and EJS templates for exit codes outside the 0=PASS/1=FAIL/2=ERROR contract.
// Usage: node scripts/check-exit-code-contract.mjs [dir...]
// Exits 1 if any violations found.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const VALID_EXITS = new Set([0, 1, 2])

// Match process.exit(N) only when not inside a string literal.
// Heuristic: count unescaped quotes before the match; odd count = inside string.
const PATTERNS = [{ re: /process\.exit\(\s*(-?\d+)\s*\)/, label: 'process.exit(N)' }]

function inStringLiteral(line, matchIndex) {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < matchIndex; i++) {
    const ch = line[i]
    if (ch === '\\' && (inSingle || inDouble)) {
      i++
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
    }
  }
  return inSingle || inDouble
}

const EXTENSIONS = new Set(['.mjs', '.js', '.ejs'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])
const SKIP_PATHS = new Set(['__tests__/fixtures'])

const args = process.argv.slice(2)
const baseDir = process.cwd()
let violations = 0

function scan(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch (err) {
    process.stderr.write(`  [warn] could not read directory ${dir}: ${err.message}\n`)
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const rel = relative(baseDir, full)
    if (SKIP_PATHS.has(rel) || rel.startsWith('__tests__/fixtures')) continue
    let stat
    try {
      stat = statSync(full)
    } catch (err) {
      process.stderr.write(`  [warn] could not stat ${full}: ${err.message}\n`)
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
  } catch (err) {
    process.stderr.write(`  [warn] could not read file ${filePath}: ${err.message}\n`)
    return
  }
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const { re, label } of PATTERNS) {
      const m = line.match(re)
      if (m) {
        const matchIdx = line.indexOf(m[0])
        if (inStringLiteral(line, matchIdx)) break
        const code = parseInt(m[1], 10)
        if (!VALID_EXITS.has(code)) {
          const rel = relative(baseDir, filePath)
          console.log(
            `  ${rel}:${i + 1}  [${label}]  exit(${code}) — must be 0, 1, or 2  ${line.trim()}`,
          )
          violations++
        }
        break
      }
    }
  }
}

if (args.length > 0) {
  const accessible = args.filter((p) => {
    try {
      statSync(p)
      return true
    } catch {
      return false
    }
  })
  if (accessible.length === 0) {
    process.stderr.write(
      '  [error] No valid scan paths — all provided paths are missing or inaccessible.\n',
    )
    process.exit(2)
  }
  for (const dir of accessible) scan(dir)
} else {
  scan(process.cwd())
}

if (violations > 0) {
  console.log(
    `\n  Found ${violations} violation(s). All scripts must exit 0=PASS / 1=FAIL / 2=ERROR.\n`,
  )
  process.exit(1)
}
