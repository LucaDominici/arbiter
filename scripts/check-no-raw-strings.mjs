#!/usr/bin/env node
// Scans TypeScript source files for raw string literals in console.* calls
// and raw throw new ArbiterError/UserFacingError sites.
// Each match must be registered in the inventory allowlist to pass.
// Usage: node scripts/check-no-raw-strings.mjs [srcDir] [--inventory <path>]
// Exits 1 if any unregistered raw strings are found.
import { readFileSync, existsSync } from 'node:fs'
import { join, relative, resolve, basename } from 'node:path'
import { walkRepo } from './lib/glob-walk.mjs'

// console.(log|warn|error)( followed by a quote character (start of raw string)
const RAW_CONSOLE = /\bconsole\.(log|warn|error)\(\s*['"`]/
// throw new ArbiterError( or throw new UserFacingError( (not fromKey)
const RAW_THROW = /\bthrow\s+new\s+(ArbiterError|UserFacingError)\s*\(/

// Exclusion: console.log(t( or console.log(resolveLocale( — already using i18n
const I18N_CALL = /\bconsole\.(log|warn|error)\(\s*(t|resolveLocale)\s*[(`]/

const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js'])
const SKIP_EXTS = new Set(['.d.ts'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'templates'])

// Parse args
const args = process.argv.slice(2)
let srcDir = 'src'
let inventoryPath = null

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--inventory' && args[i + 1]) {
    inventoryPath = args[i + 1]
    i++
  } else if (!args[i].startsWith('--')) {
    srcDir = args[i]
  }
}

// Load allowlist
const allowlist = new Set()
if (inventoryPath && existsSync(inventoryPath)) {
  const raw = JSON.parse(readFileSync(inventoryPath, 'utf-8'))
  for (const entry of raw) {
    if (entry.file && entry.line) {
      allowlist.add(`${entry.file}:${entry.line}`)
    }
  }
}

function isSkippedExt(name) {
  for (const skip of SKIP_EXTS) {
    if (name.endsWith(skip)) return true
  }
  return false
}

function scanFile(filePath) {
  const violations = []
  if (isSkippedExt(basename(filePath))) return violations
  const ext = filePath.slice(filePath.lastIndexOf('.'))
  if (!EXTENSIONS.has(ext)) return violations

  const lines = readFileSync(filePath, 'utf-8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1
    const rel = relative(srcDir, filePath)
    const key = `${rel}:${lineNum}`

    const isRawConsole = RAW_CONSOLE.test(line) && !I18N_CALL.test(line)
    const isRawThrow = RAW_THROW.test(line)

    if ((isRawConsole || isRawThrow) && !allowlist.has(key)) {
      violations.push({ file: rel, line: lineNum, snippet: line.trim() })
    }
  }
  return violations
}

function scan(dir, violations) {
  // Cycle-safe walk via the shared helper (#1521). walkRepo prunes vendor trees and never
  // recurses into a symlinked directory; we re-apply this script's own SKIP_DIRS (e.g. `templates`)
  // as a path-segment filter so the visited set is identical, minus the symlink-cycle bug.
  for (const rel of walkRepo(resolve(dir))) {
    if (rel.split('/').some((seg) => SKIP_DIRS.has(seg))) continue
    violations.push(...scanFile(join(dir, rel)))
  }
}

const violations = []
scan(srcDir, violations)

if (violations.length > 0) {
  console.log(`check-no-raw-strings: ${violations.length} violation(s) found:\n`)
  for (const v of violations) {
    console.log(`  ${v.file}:${v.line}  ${v.snippet}`)
  }
  console.log(
    '\nEach raw string must be migrated to t(key) or registered in the inventory allowlist.',
  )
  process.exit(1)
} else {
  console.log('check-no-raw-strings: OK')
  process.exit(0)
}
