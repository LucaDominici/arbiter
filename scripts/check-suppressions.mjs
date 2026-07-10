#!/usr/bin/env node
// arbiter — suppression expiry check (INV-31)
// Validates that all suppression entries have mandatory metadata and a future expiresAt.
// Usage: node scripts/check-suppressions.mjs
import { readFileSync, existsSync } from 'node:fs'

const REQUIRED_FIELDS = ['reason', 'owner', 'expiresAt', 'scope']
const REASON_MIN_LEN = 10
const WARN_DAYS = 30
let failed = 0
let warnings = 0

function checkExpiry(expiresAt, label, file) {
  const expiry = new Date(expiresAt)
  if (isNaN(expiry.getTime())) {
    process.stderr.write(
      `[FAIL] ${file}: ${label} — invalid expiresAt (not a date): ${expiresAt}\n`,
    )
    failed++
    return
  }
  const now = new Date()
  const diffMs = expiry.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  if (diffMs < 0) {
    process.stderr.write(`[EXPIRED] ${file}: ${label} — expiresAt: ${expiresAt}\n`)
    failed++
  } else if (diffDays <= WARN_DAYS) {
    process.stderr.write(`[WARN] ${file}: ${label} expires in ${diffDays} day(s) (${expiresAt})\n`)
    warnings++
  }
}

function validateEntry(entry, label, file) {
  let valid = true
  for (const field of REQUIRED_FIELDS) {
    if (!entry[field]) {
      process.stderr.write(`[FAIL] ${file}: ${label} — missing required field: ${field}\n`)
      failed++
      valid = false
    }
  }
  if (valid && entry.reason.length < REASON_MIN_LEN) {
    process.stderr.write(
      `[FAIL] ${file}: ${label} — reason must be at least ${REASON_MIN_LEN} characters\n`,
    )
    failed++
    valid = false
  }
  if (valid) {
    checkExpiry(entry.expiresAt, label, file)
  }
}

function parseMetaComment(commentText) {
  const result = {}
  for (const field of REQUIRED_FIELDS) {
    const match = commentText.match(new RegExp(`${field}:\\s*([^|\\n]+)`))
    if (match) result[field] = match[1].trim()
  }
  return result
}

function checkJsonFile(filePath) {
  if (!existsSync(filePath)) return
  const raw = readFileSync(filePath, 'utf-8').trim()
  if (!raw || raw === '[]') return
  let entries
  try {
    entries = JSON.parse(raw)
  } catch (e) {
    process.stderr.write(`[FAIL] ${filePath}: could not parse JSON — ${e.message}\n`)
    failed++
    return
  }
  if (!Array.isArray(entries)) {
    process.stderr.write(`[FAIL] ${filePath}: expected a JSON array, got ${typeof entries}\n`)
    failed++
    return
  }
  if (entries.length === 0) return
  for (let i = 0; i < entries.length; i++) {
    validateEntry(entries[i], `entry[${i}]`, filePath)
  }
}

// .trivyignore entries are single lines (no preceding metadata comment, unlike the XML
// suppress-block format): `<CVE-ID> exp:<YYYY-MM-DD> # reason=<text> owner=@<handle>`.
// Blank lines and full-line `#` comments (the file's own header/policy block) are skipped.
const TRIVYIGNORE_ENTRY_RE =
  /^(\S+)\s+exp:(\d{4}-\d{2}-\d{2})(?:\s*#\s*reason=(.*?)\s+owner=(@\S+))?\s*$/

function parseTrivyignoreLine(line) {
  const match = TRIVYIGNORE_ENTRY_RE.exec(line)
  if (!match) return { scope: line.split(/\s+/)[0] }
  const [, scope, expiresAt, reason, owner] = match
  return { scope, expiresAt, reason, owner }
}

function checkTrivyignoreFile(filePath) {
  if (!existsSync(filePath)) return
  const lines = readFileSync(filePath, 'utf-8').split('\n')
  let idx = 0
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const entry = parseTrivyignoreLine(line)
    validateEntry(entry, `entry[${idx}] (${entry.scope})`, filePath)
    idx++
  }
}

function checkGitleaksFile(filePath) {
  if (!existsSync(filePath)) return
  const lines = readFileSync(filePath, 'utf-8').split('\n')
  let lastComment = null
  let idx = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') {
      // blank lines do not reset lastComment
    } else if (trimmed.startsWith('#')) {
      lastComment = trimmed.slice(1).trim()
    } else {
      // Non-comment, non-blank line is a suppression entry
      const meta = lastComment ? parseMetaComment(lastComment) : {}
      validateEntry(meta, `entry[${idx}] (${trimmed.slice(0, 40)})`, filePath)
      idx++
      lastComment = null
    }
  }
}

checkJsonFile('suppressions/pii-allowlist.json')
checkJsonFile('suppressions/archunit-baseline.json')
checkJsonFile('suppressions/consumer-audit-allowlist.json')
checkTrivyignoreFile('.trivyignore')
checkGitleaksFile('suppressions/.gitleaksignore')

if (failed > 0) {
  process.stderr.write(`\n[SUMMARY] ${failed} suppression(s) failed expiry/field check\n`)
  process.exit(1)
} else if (warnings > 0) {
  process.stderr.write(`\n[SUMMARY] All suppressions valid — ${warnings} expiring soon\n`)
} else {
  process.stdout.write('[SUMMARY] All suppressions valid\n')
}
