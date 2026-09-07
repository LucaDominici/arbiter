#!/usr/bin/env node
// Scans scripts and EJS templates for exit codes outside the 0=PASS/1=FAIL/2=ERROR contract.
// Usage: node scripts/check-exit-code-contract.mjs [dir...]
// Exits 1 if any violations found.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const VALID_EXITS = new Set([0, 1, 2, 78])

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
// .arbiter/ is gitignored runtime/scratch state (see .gitignore: `.arbiter/**`)
// — it can contain copied build output (e.g. a killed e2e run's leftover
// dist/ copy) that the repo does not ship and must never fail this check.
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.arbiter'])
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
          process.stdout.write(
            `  ${rel}:${i + 1}  [${label}]  exit(${code}) — must be 0, 1, 2, or 78  ${line.trim()}\n`,
          )
          violations++
        }
        break
      }
    }
  }
}

if (args.length > 0) {
  // #2418: inaccessible paths used to be silently filtered out, so a typo'd or unreadable
  // scan root shrank the corpus and the gate still reported PASS over whatever survived —
  // an unauditable path must stop the audit, not narrow it.
  const inaccessible = []
  for (const p of args) {
    try {
      statSync(p)
    } catch (err) {
      process.stderr.write(`  [error] scan path ${p} is unusable: ${err?.message ?? err}\n`)
      inaccessible.push(p)
    }
  }
  if (inaccessible.length > 0) {
    process.stderr.write(
      `  [error] ${inaccessible.length} scan path(s) missing or inaccessible — refusing to ` +
        `audit a partial corpus:\n` +
        inaccessible.map((p) => `    - ${p}\n`).join(''),
    )
    process.exit(2)
  }
  for (const dir of args) scan(dir)
} else {
  scan(process.cwd())
}

if (violations > 0) {
  process.stdout.write(
    `\n  Found ${violations} violation(s). All scripts must exit 0=PASS / 1=FAIL / 2=ERROR / 78=CONFIG.\n`,
  )
  process.exit(1)
}
