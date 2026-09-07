#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: validates every tabletop evidence file (.arbiter/evidence/tabletop/*.md) against schemas/tabletop-evidence.schema.json — frontmatter counts must equal the findings table and every blocker/major finding must carry an owner.
// CATALOG: rejected fold-in into check-agent-return.mjs because agent-return envelopes are per-dispatch verdict/citation artifacts with a different schema and lifecycle; tabletop evidence is a per-journey findings ledger.
// CATALOG: rejected fold-in into check-acceptance.mjs because ac-fit is per-task acceptance verdicts against a plan anchor, not doc-vs-behaviour observations with owners.
// scripts/check-tabletop-evidence.mjs
// L1 gate (#2429): validate every tabletop evidence DEFINITION and every tabletop evidence FILE,
// and join the two.
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
// TT-NN (#2480 wave 8) adds the other half. The evidence was schema'd from the start; the SCENARIO
// DEFINITIONS it is written against were prose, held only by a hand-maintained slug list in
// __tests__/docs/tabletop-scenarios.test.ts. So over docs/internal/METHOD/TABLETOP-SCENARIOS.md:
//   6. every `## N. <title>` block declares a TT-NN id, a slug, and the five remaining fields,
//   7. ids and slugs are each unique, and the slug is the kebab-case form the evidence filename
//      convention `<slug>-<date>.md` already depends on,
//   8. THE JOIN: every evidence file's `scenario` names a declared slug. This is the rule that
//      could not exist while the definitions were prose — an exercise could be walked, and its
//      blockers recorded, against a scenario that no longer existed or never did, and the evidence
//      would validate perfectly against its schema on the way past.
// The definitions pass is skipped when the catalogue is absent: a governed project need not seed
// one. The join is skipped with it, and says so — an unjoinable evidence file is not a valid one.
//
// The id and the slug coexist for the reason ADR-NNN and its filename slug do: the id is the
// stable citation key a use case or a runbook points at, the slug is the human-readable key the
// evidence filenames are built from, and either alone would have to serve both jobs badly.
//
// Usage: node scripts/check-tabletop-evidence.mjs [--dir <repo>]
// Exit: 0 pass or skip, 1 violation, 2 error (INV-53).
//
// Exports for unit tests: parseFrontmatter, validateFrontmatter, parseFindingsTable,
//                         parseScenarios, scenarioViolations, joinViolations

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { isMainModule } from './lib/run-helpers.mjs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = resolve(scriptDir, '..', 'schemas', 'tabletop-evidence.schema.json')
const EVIDENCE_REL = join('.arbiter', 'evidence', 'tabletop')
const SCENARIOS_REL = join('docs', 'internal', 'METHOD', 'TABLETOP-SCENARIOS.md')

/** The seven fields every scenario block carries, beyond its heading. */
const SCENARIO_FIELDS = [
  'Id',
  'Slug',
  'Persona',
  'Starting state',
  'Goal',
  'Docs the user would read',
  'Executable probes',
  'Exit criterion',
]

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

/**
 * The `## N. <title>` blocks of the catalogue, as records. Deliberately not a markdown parser: the
 * catalogue's shape is two productions deep, and a gate that needs a parser to read the document
 * it governs is a gate whose document a human cannot read either.
 * @param {string} text
 * @returns {Array<{heading: string, id: string|null, slug: string|null, missing: string[]}>}
 */
export function parseScenarios(text) {
  return text
    .split(/^## (?=\d+\. )/m)
    .slice(1)
    .map((block) => {
      const body = `## ${block}`
      const field = (name) => {
        const m = new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.*)$`, 'm').exec(body)
        return m ? m[1].trim() : null
      }
      const backticked = (name) => {
        const raw = field(name)
        if (raw === null) return null
        const m = /^`([^`]+)`$/.exec(raw)
        return m ? m[1] : raw
      }
      return {
        heading: body.split('\n')[0].replace(/^## /, '').trim(),
        id: backticked('Id'),
        slug: backticked('Slug'),
        missing: SCENARIO_FIELDS.filter((name) => field(name) === null),
      }
    })
}

/**
 * Structural defects in the catalogue itself. A scenario with no id cannot be cited; two scenarios
 * with one slug make the evidence filename convention ambiguous, and the second exercise silently
 * overwrites the first's evidence.
 * @param {ReturnType<typeof parseScenarios>} scenarios
 * @returns {string[]}
 */
export function scenarioViolations(scenarios) {
  const errors = []
  const seenIds = new Map()
  const seenSlugs = new Map()
  for (const s of scenarios) {
    const where = `scenario "${s.heading}"`
    if (s.missing.length > 0) {
      errors.push(`${where}: missing field(s) ${s.missing.join(', ')}`)
    }
    if (s.id !== null) {
      if (!/^TT-[0-9]{2}$/.test(s.id))
        errors.push(`${where}: id "${s.id}" does not match ^TT-[0-9]{2}$`)
      else if (seenIds.has(s.id))
        errors.push(`${where}: id ${s.id} is already used by "${seenIds.get(s.id)}"`)
      else seenIds.set(s.id, s.heading)
    }
    if (s.slug !== null) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.slug)) {
        errors.push(
          `${where}: slug "${s.slug}" is not kebab-case — the evidence filename convention <slug>-<date>.md depends on it`,
        )
      } else if (seenSlugs.has(s.slug)) {
        errors.push(`${where}: slug "${s.slug}" is already used by "${seenSlugs.get(s.slug)}"`)
      } else {
        seenSlugs.set(s.slug, s.heading)
      }
    }
  }
  return errors
}

/**
 * The join. An evidence file naming a scenario the catalogue does not declare is either evidence
 * for something that was never defined, or evidence orphaned by a rename — and both read as a
 * perfectly valid evidence file from inside the file.
 * @param {Array<{file: string, scenario: unknown}>} evidence
 * @param {ReturnType<typeof parseScenarios>} scenarios
 * @returns {string[]}
 */
export function joinViolations(evidence, scenarios) {
  const declared = new Set(scenarios.map((s) => s.slug).filter((s) => s !== null))
  const errors = []
  for (const { file, scenario } of evidence) {
    if (typeof scenario !== 'string' || scenario.trim() === '') continue // the schema already said so
    if (declared.has(scenario)) continue
    errors.push(
      `${file}: scenario "${scenario}" is not declared in ${SCENARIOS_REL} — evidence for an undefined scenario, or orphaned by a rename`,
    )
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

/**
 * The catalogue half: parse it, report its structural defects, and hand the scenarios back for the
 * join. `null` means there is no catalogue to read — distinct from an empty one, which is a
 * catalogue declaring no scenarios and is itself fine.
 * @param {string} repoRoot
 * @returns {{ scenarios: ReturnType<typeof parseScenarios> | null, errors: string[] }}
 */
function checkScenarios(repoRoot) {
  const path = join(repoRoot, SCENARIOS_REL)
  if (!existsSync(path)) {
    return { scenarios: null, errors: [], note: `, no ${SCENARIOS_REL} (join skipped)` }
  }
  const scenarios = parseScenarios(readFileSync(path, 'utf-8'))
  return {
    scenarios,
    errors: scenarioViolations(scenarios),
    note: `, ${scenarios.length} scenario(s) declared`,
  }
}

/** `--dir <repo>`, defaulting to the cwd. */
function repoRootFrom(argv) {
  const i = argv.indexOf('--dir')
  return i !== -1 && argv[i + 1] ? resolve(argv[i + 1]) : process.cwd()
}

/**
 * Report a catalogue that will not parse cleanly. Split out of main so the entry point stays a
 * sequence of decisions rather than a sequence of decisions interleaved with their printing.
 * @returns {number|null} an exit code, or null to continue
 */
function reportCatalogue(catalogue) {
  if (catalogue.errors.length === 0) return null
  process.stderr.write(`[tabletop-evidence] FAIL ${SCENARIOS_REL}:\n`)
  for (const e of catalogue.errors) process.stderr.write(`  - ${e}\n`)
  return 1
}

/**
 * Validate every evidence file, and collect what each one CLAIMS its scenario is.
 *
 * The claim is collected even from a file that failed something else: a file can be malformed and
 * point at a scenario that does not exist, and reporting only the first sends the author back for
 * a second round over a defect that was already on screen.
 * @returns {{ failed: number, claimed: Array<{file: string, scenario: unknown}> }}
 */
function checkEvidenceFiles(evidenceDir, files, schema) {
  let failed = 0
  /** @type {Array<{file: string, scenario: unknown}>} */
  const claimed = []
  for (const file of files) {
    const path = join(evidenceDir, file)
    const errors = checkFile(path, schema)
    const parsed = parseFrontmatter(readFileSync(path, 'utf-8'))
    if (parsed) claimed.push({ file: join(EVIDENCE_REL, file), scenario: parsed.data.scenario })
    if (errors.length === 0) continue
    failed++
    process.stderr.write(`[tabletop-evidence] FAIL ${join(EVIDENCE_REL, file)}:\n`)
    for (const e of errors) process.stderr.write(`  - ${e}\n`)
  }
  return { failed, claimed }
}

/** The evidence files to check, or an exit code and message when there are none to check. */
function evidenceFiles(evidenceDir, catalogueNote) {
  if (!existsSync(evidenceDir)) {
    return {
      code: 0,
      message: `[tabletop-evidence] OK — no ${EVIDENCE_REL}/ directory (nothing to check)${catalogueNote}\n`,
    }
  }
  const files = readdirSync(evidenceDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
  if (files.length === 0) {
    return {
      code: 0,
      message: `[tabletop-evidence] OK — ${EVIDENCE_REL}/ holds no evidence file${catalogueNote}\n`,
    }
  }
  return { files }
}

function main(argv) {
  const repoRoot = repoRootFrom(argv)

  const catalogue = checkScenarios(repoRoot)
  const catalogueCode = reportCatalogue(catalogue)
  if (catalogueCode !== null) return catalogueCode

  const evidenceDir = join(repoRoot, EVIDENCE_REL)
  const found = evidenceFiles(evidenceDir, catalogue.note)
  if (found.files === undefined) {
    process.stdout.write(found.message)
    return found.code
  }
  if (!existsSync(SCHEMA_PATH)) {
    process.stderr.write(`[tabletop-evidence] FAIL: schema not found at ${SCHEMA_PATH}\n`)
    return 1
  }

  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'))
  const { failed, claimed } = checkEvidenceFiles(evidenceDir, found.files, schema)

  const unjoined = catalogue.scenarios === null ? [] : joinViolations(claimed, catalogue.scenarios)
  for (const e of unjoined) process.stderr.write(`[tabletop-evidence] FAIL — ${e}\n`)

  if (failed > 0 || unjoined.length > 0) {
    process.stderr.write(
      `[tabletop-evidence] FAIL: ${failed}/${found.files.length} evidence file(s) invalid, ` +
        `${unjoined.length} unjoined to a declared scenario\n`,
    )
    return 1
  }
  process.stdout.write(
    `[tabletop-evidence] OK — ${found.files.length} evidence file(s) valid${catalogue.note}\n`,
  )
  return 0
}

// Guarded so the module can be IMPORTED. Until #2480 wave 8 this ran main() at import time, which
// is why nothing unit-tested its internals: any test that imported it ran the gate against the
// test runner's cwd instead. A gate that cannot be imported can only ever be tested through a
// subprocess, and that is how a parser goes untested for a year.
if (isMainModule(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    // Exit 2, not 1: INV-53 reserves 1 for "the artifacts are wrong" and 2 for "the gate could not
    // tell". Conflating them files an EACCES or a corrupt schema as a tabletop finding. Pre-existing
    // defect, fixed at the root here rather than left because this wave was only passing through
    // (CANON-22); the arc42 gate carried the identical one.
    process.stderr.write(`[tabletop-evidence] ERROR — unexpected: ${err.message}\n`)
    process.exit(2)
  }
}
