#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/check-tabletop-evidence.mjs
// L1 gate (#2429): validate every tabletop evidence file under .arbiter/evidence/tabletop/.
//
// A tabletop exercise is high-recall and low-precision by construction — it walks a whole
// journey and reports everything that looks off. That only pays for itself if each serious
// finding TERMINATES: in an issue, or in a fix on the same train. This gate is that
// terminator. It asserts:
//   1. frontmatter parses and satisfies schemas/tabletop-evidence.schema.json,
//   2. the findings table carries exactly the declared columns,
//   3. every row's severity and class are declared values,
//   4. every blocker/major row names an owner (`#NNN`, an https URL, or `fixed:<sha>`),
//   5. the frontmatter per-severity counts equal the table's row counts.
// Vacuous pass when .arbiter/evidence/tabletop/ is absent or holds no .md file.
//
// Usage: node scripts/check-tabletop-evidence.mjs [--dir <repo>]
// Exits 1 on any violation; 0 otherwise.
//
// Exports for unit tests: parseFrontmatter, validateFrontmatter, parseFindingsTable

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = resolve(scriptDir, '..', 'schemas', 'tabletop-evidence.schema.json')
const EVIDENCE_REL = join('.arbiter', 'evidence', 'tabletop')

/**
 * Minimal frontmatter reader: `key: value` plus one level of two-space-indented nesting.
 * Deliberately not a YAML engine — an evidence header the gate cannot read with 20 lines of
 * parsing is an evidence header a human cannot read either.
 */
/** Unquote a scalar and coerce a bare integer — the only two YAML shapes evidence uses. */
function scalar(raw) {
  const value = raw.trim().replace(/^['"]|['"]$/g, '')
  return /^-?\d+$/.test(value) ? Number(value) : value
}

export function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return null
  const end = text.indexOf('\n---', 3)
  if (end === -1) return null
  const data = {}
  let parent = null
  for (const line of text.slice(4, end).split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const m = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!m) return null
    const [, indent, key, rawValue] = m
    if (indent.length > 0) {
      if (!parent) return null
      parent[key] = scalar(rawValue)
      continue
    }
    if (rawValue.trim() === '') {
      parent = {}
      data[key] = parent
      continue
    }
    parent = null
    data[key] = scalar(rawValue)
  }
  return { data, body: text.slice(end + 4) }
}

/** The declared `type` mismatch for one value, or null when the type holds. */
function typeError(value, type, path) {
  if (type === 'integer' && !Number.isInteger(value)) {
    return `${path}: expected an integer, got ${JSON.stringify(value)}`
  }
  if (type === 'string' && typeof value !== 'string') {
    return `${path}: expected a string, got ${JSON.stringify(value)}`
  }
  if (type === 'object' && (typeof value !== 'object' || value === null)) {
    return `${path}: expected an object`
  }
  return null
}

/** The scalar constraints the evidence contract uses: pattern, minLength, minimum. */
function constraintErrors(value, schema, path) {
  const errors = []
  if (schema.pattern && !new RegExp(schema.pattern).test(String(value))) {
    errors.push(`${path}: "${String(value)}" does not match ${schema.pattern}`)
  }
  if (schema.minLength !== undefined && String(value).length < schema.minLength) {
    errors.push(`${path}: shorter than ${schema.minLength} characters`)
  }
  if (schema.minimum !== undefined && Number(value) < schema.minimum) {
    errors.push(`${path}: below the minimum of ${schema.minimum}`)
  }
  return errors
}

/** The JSON-Schema subset the evidence contract uses: type, required, pattern, bounds. */
function validateValue(value, schema, path, errors) {
  const bad = typeError(value, schema.type, path)
  if (bad) {
    errors.push(bad)
    return
  }
  if (schema.type === 'object') {
    validateObject(value, schema, path, errors)
    return
  }
  errors.push(...constraintErrors(value, schema, path))
}

function validateObject(obj, schema, path, errors) {
  for (const key of schema.required ?? []) {
    if (obj[key] === undefined) errors.push(`${path ? `${path}.` : ''}${key}: missing (required)`)
  }
  for (const [key, sub] of Object.entries(schema.properties ?? {})) {
    if (obj[key] === undefined) continue
    validateValue(obj[key], sub, path ? `${path}.${key}` : key, errors)
  }
}

/** Frontmatter object → schema violations (empty array when valid). */
export function validateFrontmatter(data, schema) {
  const errors = []
  validateObject(data, schema, '', errors)
  return errors
}

function cells(line) {
  const trimmed = line.trim()
  return trimmed
    .slice(trimmed.startsWith('|') ? 1 : 0, trimmed.endsWith('|') ? -1 : undefined)
    .split('|')
    .map((c) => c.trim())
}

/** Declared-value and owner violations for one findings row. */
function rowErrors(row, contract, where, ownerRe) {
  const errors = []
  if (!contract.severity.includes(row.severity)) {
    errors.push(`${where}: unknown severity "${row.severity}"`)
  }
  if (!contract.class.includes(row.class)) {
    errors.push(`${where}: unknown class "${row.class}"`)
  }
  if (contract.ownerRequiredFor.includes(row.severity) && !ownerRe.test(row.owner)) {
    errors.push(
      `${where}: a ${row.severity} finding needs an owner (#NNN, an https URL, or fixed:<sha>), got "${row.owner}"`,
    )
  }
  return errors
}

/**
 * Locate and parse the findings table. Returns `{ errors, rows }`; `rows` are objects keyed by
 * the contract's column names. A body with no recognisable table is itself an error — an
 * evidence file without findings must still print the (possibly empty) table.
 */
export function parseFindingsTable(body, contract) {
  const errors = []
  const lines = body.split('\n')
  const want = contract.columns.map((c) => c.toLowerCase()).join(' | ')
  // Match the header by CONTENT, not by cell count: the separator row and any other
  // seven-column table in the narrative also have seven cells, and matching one of those
  // would report a header mismatch against a table that is not the findings table.
  const headerIdx = lines.findIndex(
    (l) =>
      l.trim().startsWith('|') &&
      cells(l)
        .map((c) => c.toLowerCase())
        .join(' | ') === want,
  )
  if (headerIdx === -1) {
    errors.push(`no findings table with the declared header: ${want}`)
    return { errors, rows: [] }
  }
  // The row scan starts past the separator; if that line is not one, the first finding
  // would be silently skipped — and a silently dropped blocker is the one thing this gate
  // exists to prevent.
  if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[headerIdx + 1] ?? '')) {
    errors.push('findings table has no `| --- |` separator row under its header')
    return { errors, rows: [] }
  }
  const rows = []
  const ownerRe = new RegExp(contract.ownerPattern)
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim().startsWith('|')) break
    const cs = cells(line)
    if (cs.length !== contract.columns.length) {
      errors.push(`row ${rows.length + 1}: ${cs.length} cells, expected ${contract.columns.length}`)
      continue
    }
    const row = Object.fromEntries(contract.columns.map((c, idx) => [c, cs[idx]]))
    rows.push(row)
    errors.push(
      ...rowErrors(row, contract, `row ${rows.length} (step ${row.step || '?'})`, ownerRe),
    )
  }
  return { errors, rows }
}

function checkCounts(declared, rows, contract) {
  const errors = []
  for (const severity of contract.severity) {
    const actual = rows.filter((r) => r.severity === severity).length
    const claimed = declared?.[severity]
    if (claimed !== actual) {
      errors.push(`findings.${severity}: frontmatter says ${claimed}, table has ${actual}`)
    }
  }
  return errors
}

function checkFile(path, schema) {
  const text = readFileSync(path, 'utf-8')
  const parsed = parseFrontmatter(text)
  if (!parsed) return ['frontmatter is missing or unparseable']
  const errors = validateFrontmatter(parsed.data, schema)
  const contract = schema['x-findings-table']
  const table = parseFindingsTable(parsed.body, contract)
  const tableOk = table.errors.length === 0
  errors.push(...table.errors)
  // Only reconcile counts once BOTH sides parsed. A malformed `findings:` block already
  // failed the schema; adding three "says undefined, table has N" lines on top buries the
  // one error that explains the file.
  if (tableOk && errors.length === 0) {
    errors.push(...checkCounts(parsed.data.findings, table.rows, contract))
  }
  return errors
}

function main(argv) {
  const dirIdx = argv.indexOf('--dir')
  const repoRoot = dirIdx !== -1 && argv[dirIdx + 1] ? resolve(argv[dirIdx + 1]) : process.cwd()
  const evidenceDir = join(repoRoot, EVIDENCE_REL)
  if (!existsSync(evidenceDir)) {
    process.stdout.write(
      `[tabletop-evidence] OK — no ${EVIDENCE_REL}/ directory (nothing to check)\n`,
    )
    return 0
  }
  const files = readdirSync(evidenceDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
  if (files.length === 0) {
    process.stdout.write(`[tabletop-evidence] OK — ${EVIDENCE_REL}/ holds no evidence file\n`)
    return 0
  }
  if (!existsSync(SCHEMA_PATH)) {
    process.stderr.write(`[tabletop-evidence] FAIL: schema not found at ${SCHEMA_PATH}\n`)
    return 1
  }
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'))
  let failed = 0
  for (const file of files) {
    const errors = checkFile(join(evidenceDir, file), schema)
    if (errors.length === 0) continue
    failed++
    process.stderr.write(`[tabletop-evidence] FAIL ${join(EVIDENCE_REL, file)}:\n`)
    for (const e of errors) process.stderr.write(`  - ${e}\n`)
  }
  if (failed > 0) {
    process.stderr.write(
      `[tabletop-evidence] FAIL: ${failed}/${files.length} evidence file(s) invalid\n`,
    )
    return 1
  }
  process.stdout.write(`[tabletop-evidence] OK — ${files.length} evidence file(s) valid\n`)
  return 0
}

try {
  process.exit(main(process.argv.slice(2)))
} catch (err) {
  process.stderr.write(`[tabletop-evidence] ERROR — unexpected: ${err.message}\n`)
  process.exit(1)
}
