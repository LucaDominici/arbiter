#!/usr/bin/env node
// Arbiter hook: block PII patterns in edited files (INV-12)
// Fires on: PostToolUse → Edit|Write
import { readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { findInlineSuppression, resolveToolInputPath } from './lib.mjs'
import { isAllowedByEntry } from '../../scripts/lib/suppressions-shared.mjs'

const file = resolveToolInputPath()
if (!file || !existsSync(file)) process.exit(0)

// Load suppressions/pii-allowlist.json (same semantics as scripts/pii-scan.mjs's
// isAllowed): the hook told users to add allowlist entries for fixtures but never
// actually consulted the file (#1779/#1780) — fixed by reusing that check here.
const ROOT = process.cwd()
const ALLOWLIST_PATH = join(ROOT, 'suppressions', 'pii-allowlist.json')
let allowlist = []
if (existsSync(ALLOWLIST_PATH)) {
  try {
    const parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf-8'))
    if (Array.isArray(parsed)) allowlist = parsed
  } catch {
    // Malformed allowlist: fail closed (no entries allowed), do not weaken enforcement.
  }
}

// #1809: matching logic lives in scripts/lib/suppressions-shared.mjs, shared
// verbatim with scripts/pii-scan.mjs — see isAllowedByEntry's docstring for the
// specificity-floor semantics (kept in lockstep with that gate script).
function isAllowlisted(filePath, lineNum, matchStr) {
  const rel = relative(ROOT, filePath).split('\\').join('/')
  return isAllowedByEntry(allowlist, rel, lineNum, matchStr)
}

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
  '.toml',
  '.json',
]
if (SKIP_EXTENSIONS.some((ext) => file.endsWith(ext))) process.exit(0)

let content
try {
  content = readFileSync(file, 'utf-8')
} catch {
  process.exit(0)
}

const PII_PATTERNS = [
  {
    label: 'email address',
    re: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/,
  },
  { label: 'phone (E.164)', re: /\+\d{7,15}\b/ },
  {
    label: 'credit card (Luhn-like)',
    re: /\b(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13}|6(?:011|5\d{2})\d{12})\b/,
  },
]

const findings = []
const lines = content.split('\n')
for (const { label, re } of PII_PATTERNS) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re)
    if (!m) continue
    if (findInlineSuppression(content, i, 'INV-12')) continue
    if (isAllowlisted(file, i + 1, m[0])) continue
    findings.push(`  line ${i + 1} [${label}]: ${lines[i].trim().slice(0, 80)}`)
  }
}

if (findings.length > 0) {
  process.stderr.write(`[arbiter] INV-12: PII pattern detected in ${file}:\n`)
  findings.slice(0, 5).forEach((f) => process.stderr.write(`${f}\n`))
  process.stderr.write(
    `Add an allowlist entry to suppressions/pii-allowlist.json if this is a test fixture.\n`,
  )
  process.stderr.write(`[arbiter] Run \`arbiter explain INV-12\` for details.\n`)
  // Exit 2 feeds the violation back to the agent for a PostToolUse guard (#1631).
  process.exit(2)
}
