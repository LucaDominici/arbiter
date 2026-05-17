#!/usr/bin/env node
// Scans source files for orphan TODO comments (missing task ID).
// Valid: // TODO(#123): description
// Invalid: // TODO: description  or  // TODO without task ID
// Usage: node scripts/check-no-orphan-todo.mjs [dir...]
// Exits 1 if any violations are found.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Match // TODO or /* TODO or * TODO (in comment context), but NOT TODO(#NNN)
const ORPHAN_TODO = /(?:\/\/|\/\*|\*)\s*TODO(?!\s*\(#\d+\))/
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'templates'])

const scanDirs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['src', '__tests__']

let violations = 0
const baseDir = process.cwd()

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
    const stat = statSync(full)
    if (stat.isDirectory()) {
      scan(full)
    } else if (EXTENSIONS.has(full.slice(full.lastIndexOf('.')))) {
      scanFile(full)
    }
  }
}

function scanFile(filePath) {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (ORPHAN_TODO.test(lines[i])) {
      const rel = relative(baseDir, filePath)
      process.stdout.write(`  ${rel}:${i + 1}  ${lines[i].trim()}
`)
      violations++
    }
  }
}

for (const dir of scanDirs) {
  scan(join(baseDir, dir))
}

if (violations > 0) {
  process.stdout.write(`\n  Found ${violations} orphan TODO(s). Use TODO(#NNN): format.\n
`)
  process.exit(1)
}
