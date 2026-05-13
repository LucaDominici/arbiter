#!/usr/bin/env node
// arbiter — inline suppression checker (INV-31)
// Validates arbiter-suppress directives in source files.
// Directive form: arbiter-suppress(INV-NN, until=YYYY-MM-DD, reason="...", owner=@user)

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REASON_MIN_LEN = 10
const WARN_DAYS = 30
const DIRECTIVE_RE = /\/\/\s*arbiter-suppress\(([^)]+)\)/g
const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.java',
  '.kt',
  '.rs',
  '.py',
  '.rb',
  '.go',
])
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__tests__'])
const KNOWN_INV_IDS = new Set([
  'INV-01',
  'INV-02',
  'INV-03',
  'INV-04',
  'INV-05',
  'INV-06',
  'INV-07',
  'INV-08',
  'INV-09',
  'INV-10',
  'INV-11',
  'INV-12',
  'INV-13',
  'INV-14',
  'INV-15',
  'INV-16',
  'INV-17',
  'INV-18',
  'INV-19',
  'INV-20',
  'INV-21',
  'INV-22',
  'INV-23',
  'INV-24',
  'INV-25',
  'INV-26',
  'INV-27',
  'INV-28',
  'INV-29',
  'INV-30',
  'INV-31',
  'INV-32',
  'INV-33',
  'INV-34',
  'INV-35',
  'INV-36',
  'INV-37',
  'INV-38',
  'INV-39',
])

function checkExpiry(dateStr, label, file, counters) {
  const expiry = new Date(dateStr)
  if (isNaN(expiry.getTime())) {
    process.stderr.write(
      `[FAIL] ${file}: ${label} — invalid until/expiresAt (not a date): ${dateStr}\n`,
    )
    counters.failed++
    return
  }
  const now = new Date()
  const diffMs = expiry.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  if (diffMs < 0) {
    process.stderr.write(`[FAIL] ${file}: ${label} — expired (until/expiresAt: ${dateStr})\n`)
    counters.failed++
  } else if (diffDays <= WARN_DAYS) {
    process.stderr.write(`[WARN] ${file}: ${label} expires in ${diffDays} day(s) (${dateStr})\n`)
    counters.warnings++
  }
}

function validateEntry(entry, label, file, counters) {
  const required = ['reason', 'owner', 'expiresAt']
  let valid = true
  for (const field of required) {
    if (!entry[field]) {
      process.stderr.write(`[FAIL] ${file}: ${label} — missing required field: ${field}\n`)
      counters.failed++
      valid = false
    }
  }
  if (!valid) return
  if (entry.reason.length < REASON_MIN_LEN) {
    process.stderr.write(
      `[FAIL] ${file}: ${label} — reason must be at least ${REASON_MIN_LEN} characters\n`,
    )
    counters.failed++
    return
  }
  checkExpiry(entry.expiresAt, label, file, counters)
}

function parseArgs(argsStr) {
  const parts = []
  let current = ''
  let inQuote = false
  let quoteChar = ''
  for (const ch of argsStr) {
    if (!inQuote && (ch === '"' || ch === "'")) {
      inQuote = true
      quoteChar = ch
      current += ch
    } else if (inQuote && ch === quoteChar) {
      inQuote = false
      quoteChar = ''
      current += ch
    } else if (!inQuote && ch === ',') {
      parts.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function parseDirective(argsStr) {
  const parts = parseArgs(argsStr)
  if (parts.length === 0) return null
  const result = {}
  const firstPart = parts[0]
  if (/^INV-\d+$/.test(firstPart) || !firstPart.includes('=')) result.invId = firstPart
  for (let i = 1; i < parts.length; i++) {
    const eqIdx = parts[i].indexOf('=')
    if (eqIdx === -1) continue
    const key = parts[i].slice(0, eqIdx).trim()
    let val = parts[i].slice(eqIdx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    result[key] = val
  }
  return result
}

function scanFile(filePath, counters) {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    DIRECTIVE_RE.lastIndex = 0
    const match = DIRECTIVE_RE.exec(lines[i])
    if (!match) continue
    const label = `${filePath}:${i + 1}`
    const parsed = parseDirective(match[1])
    if (!parsed || !parsed.invId) {
      process.stderr.write(`[FAIL] ${label} — missing or malformed INV-NN identifier\n`)
      counters.failed++
      continue
    }
    if (!KNOWN_INV_IDS.has(parsed.invId)) {
      process.stderr.write(`[FAIL] ${label} — unknown invariant ID: ${parsed.invId}\n`)
      counters.failed++
      continue
    }
    validateEntry(
      { reason: parsed.reason, owner: parsed.owner, expiresAt: parsed.until },
      label,
      filePath,
      counters,
    )
  }
}

function walkDir(dir, counters) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      walkDir(fullPath, counters)
    } else if (stat.isFile()) {
      const ext = entry.slice(entry.lastIndexOf('.'))
      if (SCANNED_EXTENSIONS.has(ext)) scanFile(fullPath, counters)
    }
  }
}

const targetDir = process.argv[2] ?? '.'
const counters = { failed: 0, warnings: 0 }
walkDir(targetDir, counters)
if (counters.warnings > 0) {
  process.stderr.write(`[WARN] ${counters.warnings} suppression(s) expiring within 30 days\n`)
}
process.exit(counters.failed > 0 ? 1 : 0)
