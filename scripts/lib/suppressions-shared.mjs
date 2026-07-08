#!/usr/bin/env node
// Shared validation helpers for suppression checkers (file-based and inline).
// Used by check-suppressions.mjs and check-inline-suppressions.mjs.

export const REASON_MIN_LEN = 10
export const WARN_DAYS = 30

/**
 * Checks whether an ISO date string is expired or expiring soon.
 * Increments the caller-supplied counters via the returned object.
 * @param {string} dateStr - ISO date string (YYYY-MM-DD or full ISO)
 * @param {string} label - human label for error messages
 * @param {string} file - file path for error messages
 * @param {{ failed: number, warnings: number }} counters
 */
export function checkExpiry(dateStr, label, file, counters) {
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

/**
 * Validates a normalized suppression entry. The entry object must have:
 *   reason, owner, expiresAt (file-based) OR until (inline — mapped before calling).
 * For inline suppressions, map `until` → `expiresAt` before calling.
 *
 * @param {{ reason?: string, owner?: string, expiresAt?: string, scope?: string }} entry
 * @param {string} label
 * @param {string} file
 * @param {{ failed: number, warnings: number }} counters
 * @param {string[]} requiredFields - defaults to ["reason","owner","expiresAt"]
 */
export function validateEntry(entry, label, file, counters, requiredFields) {
  const fields = requiredFields ?? ['reason', 'owner', 'expiresAt']
  let valid = true
  for (const field of fields) {
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

/**
 * Splits arbiter-suppress argument string on commas, respecting quoted strings.
 * Used by both the inline-suppressions scanner and the hook lib.
 * @param {string} argsStr - content inside arbiter-suppress(...)
 * @returns {string[]} trimmed parts
 */
export function parseArgs(argsStr) {
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

/**
 * Parses pipe-separated key: value metadata from a comment text.
 * Used by file-based suppressions (XML, .gitleaksignore).
 * @param {string} commentText
 * @returns {Record<string, string>}
 */
export function parseMetaComment(commentText) {
  const result = {}
  for (const field of ['reason', 'owner', 'expiresAt', 'scope']) {
    const match = commentText.match(new RegExp(`${field}:\\s*([^|\\n]+)`))
    if (match) result[field] = match[1].trim()
  }
  return result
}

/**
 * #1809: specificity-floor allowlist matcher — shared by scripts/pii-scan.mjs
 * and .claude/hooks/check-no-pii.mjs so the two consumers of
 * suppressions/pii-allowlist.json can never drift back apart (both previously
 * carried their own copy of this exact logic). A suppression entry must be
 * NARROW: either an exact (file + line) pair, or an exact `pattern` string —
 * a bare file-only / line-only entry, a substring file match, or a substring
 * pattern match is rejected so one under-specified entry cannot blanket-
 * disable this HARD gate. File matching is path-segment-aware (exact file, or
 * a `/`-anchored directory prefix), never substring.
 * @param {{file?: string, line?: number, pattern?: string}[]} allowlist
 * @param {string} rel - relative path of the scanned file (forward-slash normalized)
 * @param {number} lineNum - 1-based line number of the match
 * @param {string} matchStr - the exact matched PII substring
 * @returns {boolean}
 */
export function isAllowedByEntry(allowlist, rel, lineNum, matchStr) {
  return allowlist.some((entry) => {
    const hasFile = typeof entry.file === 'string' && entry.file.length > 0
    const hasLine = typeof entry.line === 'number'
    const hasPattern = typeof entry.pattern === 'string' && entry.pattern.length > 0
    if (!(hasPattern || (hasFile && hasLine))) return false
    if (hasFile) {
      const ef = entry.file.split('\\').join('/')
      const prefix = ef.endsWith('/') ? ef : ef + '/'
      if (rel !== ef && !rel.startsWith(prefix)) return false
    }
    if (hasLine && entry.line !== lineNum) return false
    if (hasPattern && matchStr !== entry.pattern) return false
    return true
  })
}
