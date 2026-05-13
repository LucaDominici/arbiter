#!/usr/bin/env node
// Advisory scan: detects `| tee` without `set -o pipefail` or PIPESTATUS guard.
// Unguarded pipe/tee masks exit-code failures (the tee command always exits 0).
// Usage: node scripts/check-pipe-tee-hazard.mjs [dir...]
// Always exits 0 (advisory — emits [WARN], does not block).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Context window for guard detection (lines above and below the tee line).
const CONTEXT_LINES = 20

const PIPE_TEE_RE = /\|\s*tee\b/
const PIPEFAIL_RE = /set\s+-[a-z]*o\s+pipefail|set\s+-[a-z]*o pipefail/
const PIPESTATUS_RE = /\$\{?PIPESTATUS\[/

const EXTENSIONS = new Set(['.sh', '.ejs'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])

const scanDirs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [process.cwd()]
const baseDir = process.cwd()
let warnings = 0

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
    let stat
    try {
      stat = statSync(full)
    } catch (err) {
      process.stderr.write(`  [warn] could not stat ${full}: ${err.message}\n`)
      continue
    }
    if (stat.isDirectory()) {
      scan(full)
    } else {
      const name = full.slice(full.lastIndexOf('/') + 1)
      if (name.endsWith('.sh') || name.endsWith('.sh.ejs') || name.endsWith('.mjs.ejs')) {
        scanFile(full)
      }
    }
  }
}

function hasGuard(lines, hitIndex) {
  const start = Math.max(0, hitIndex - CONTEXT_LINES)
  const end = Math.min(lines.length - 1, hitIndex + CONTEXT_LINES)
  for (let i = start; i <= end; i++) {
    if (PIPEFAIL_RE.test(lines[i]) || PIPESTATUS_RE.test(lines[i])) return true
  }
  return false
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
    if (PIPE_TEE_RE.test(lines[i]) && !hasGuard(lines, i)) {
      const rel = relative(baseDir, filePath)
      console.log(
        `  [WARN] ${rel}:${i + 1}  unguarded pipe/tee — add set -o pipefail or check PIPESTATUS[0]`,
      )
      warnings++
    }
  }
}

for (const dir of scanDirs) {
  scan(dir)
}

if (warnings > 0) {
  console.log(`\n  Found ${warnings} advisory warning(s). Consider adding pipefail guards.\n`)
}
// Always exit 0 — advisory only
process.exit(0)
