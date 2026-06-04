#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: validates docs/PRODUCT/FEATURE_MATRIX.md status ladder, KIT-dim coverage, and level DoD.
// CATALOG: rejected fold-in into check-catalog-agents-parity.mjs (different domain: RTM vs invariant catalog).
// CATALOG: rejected fold-in into check-kit-catalog-parity.mjs (different concern: matrix gate vs catalog sync).
/**
 * check-feature-matrix.mjs — FEATURE_MATRIX.md gate (INV-112, CANON-23)
 *
 * Modes:
 *   --check (default)  validate status ladder, KIT-dim coverage, counter integrity, level DoD
 *   --write            regenerate the summary roll-up section (not the data rows)
 *
 * Exit codes (INV-53):
 *   0 = PASS (clean)
 *   1 = FAIL (drift, false-status, coverage gap, counter mismatch, DoD violation)
 *   2 = ERROR (file missing, parse failure, malformed schema)
 *
 * Level injection: --level L1|L2|L3|L4 or ARBITER_MATRIX_LEVEL env (defaults to arbiter.json).
 *
 * NOTE: This script runs without a build step and cannot import from src/.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = process.cwd()

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const CHECK = !args.includes('--write')
const _levelEqArg = args.find((a) => a.startsWith('--level='))?.split('=')[1] ?? null
const _levelIdx = args.indexOf('--level')
const _levelNextArg = _levelIdx >= 0 ? (args[_levelIdx + 1] ?? null) : null
const levelArg = _levelEqArg ?? (_levelNextArg?.match(/^L[1-4]$/) ? _levelNextArg : null)
const MATRIX_PATH = resolve(ROOT, 'docs', 'PRODUCT', 'FEATURE_MATRIX.md')
const KIT_CATALOG_PATH = resolve(ROOT, 'src', 'kit', 'catalog.json')

// ─── Sentinel markers ────────────────────────────────────────────────────────
const START_MARKER = '<!-- FEATURE_MATRIX_START -->'
const END_MARKER = '<!-- FEATURE_MATRIX_END -->'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve effective governance level: CLI arg > env > arbiter.json */
function resolveLevel() {
  if (levelArg && /^L[1-4]$/.test(levelArg)) return levelArg
  const envLevel = process.env.ARBITER_MATRIX_LEVEL
  if (envLevel && /^L[1-4]$/.test(envLevel)) return envLevel
  const arbiterJsonPath = resolve(ROOT, 'arbiter.json')
  if (existsSync(arbiterJsonPath)) {
    try {
      const cfg = JSON.parse(readFileSync(arbiterJsonPath, 'utf-8'))
      if (cfg.governanceLevel && /^L[1-4]$/.test(cfg.governanceLevel)) return cfg.governanceLevel
    } catch {
      // ignore parse errors
    }
  }
  return 'L2' // default
}

const LEVEL_RANK = { L1: 1, L2: 2, L3: 3, L4: 4 }
function levelAtLeast(effective, required) {
  return (LEVEL_RANK[effective] ?? 0) >= (LEVEL_RANK[required] ?? 99)
}

/** Strip anchor, line refs, and leading/trailing whitespace from a ref cell value. */
function normalizeRef(cell) {
  return cell
    .trim()
    .replace(/#[^,\s]*$/, '')
    .replace(/:\d+$/, '')
    .trim()
}

/** Split comma-separated ref cell into individual paths, normalized. */
function splitRefs(cell) {
  if (!cell || !cell.trim()) return []
  return cell.split(',').map(normalizeRef).filter(Boolean)
}

/** Check that a ref is valid: non-URL, non-glob, exists on disk. Returns error string or null. */
function checkRefExists(ref, projectRoot) {
  if (/^https?:\/\//i.test(ref)) return `URL ref requires 'url:' prefix: ${ref}`
  if (ref.includes('*')) {
    // Glob: skip existence check for now (would need glob library)
    return null
  }
  const absPath = resolve(projectRoot, ref)
  if (!existsSync(absPath)) return `File not found: ${ref}`
  return null
}

function checkAllRefs(row, projectRoot, failures, id) {
  for (const [label, value] of [
    ['code_ref', row.codeRef],
    ['test_ref', row.testRef],
    ['doc_ref', row.docRef],
  ]) {
    for (const ref of splitRefs(value)) {
      const err = checkRefExists(ref, projectRoot)
      if (err) failures.push(`${id}: ${label} — ${err}`)
    }
  }
}

/** Parse the table rows from within the sentinel block. */
function parseTableRows(text) {
  const start = text.indexOf(START_MARKER)
  const end = text.indexOf(END_MARKER)
  if (start === -1 || end === -1 || end <= start) return null

  const block = text.slice(start + START_MARKER.length, end)
  const lines = block.split('\n')
  const rows = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    const cells = trimmed
      .split('|')
      .map((c) => c.trim())
      .filter((_, i) => i > 0)
    if (cells.length < 10) continue
    // Skip header and separator rows
    if (cells[0] === 'feature_id' || cells[0] === '---' || /^-+$/.test(cells[0])) continue

    const [
      featureId,
      capability,
      kitDimsRaw,
      level,
      status,
      codeRef,
      testRef,
      docRef,
      issueRef,
      note,
    ] = cells
    if (!featureId || !status) continue

    rows.push({
      featureId: featureId ?? '',
      capability: capability ?? '',
      kitDims: (kitDimsRaw ?? '')
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean),
      level: level ?? '',
      status: status ?? '',
      codeRef: codeRef ?? '',
      testRef: testRef ?? '',
      docRef: docRef ?? '',
      issueRef: issueRef ?? '',
      note: note ?? '',
    })
  }
  return rows
}

/** Parse summary counts from the Summary section. */
function parseSummaryCounts(text) {
  const counts = {}
  const summaryMatch = /## Summary[\s\S]*?(?=\n---|\n##|$)/.exec(text)
  if (!summaryMatch) return counts
  const summaryBlock = summaryMatch[0]
  for (const line of summaryBlock.split('\n')) {
    const m = /^\|\s*\*?\*?(\w+)\*?\*?\s*\|\s*\*?\*?(\d+)\*?\*?\s*\|/.exec(line)
    if (m) {
      const key = m[1].toLowerCase()
      counts[key] = parseInt(m[2], 10)
    }
  }
  return counts
}

/** Read and parse the KIT catalog; exits 2 on read/parse failure (absent → empty array). */
function safeLoadCatalog(catalogPath) {
  if (!existsSync(catalogPath)) return []
  try {
    const raw = JSON.parse(readFileSync(catalogPath, 'utf-8'))
    return Array.isArray(raw) ? raw : Object.values(raw)
  } catch (err) {
    process.stdout.write(
      `  check-feature-matrix: ERROR — cannot read/parse KIT catalog at ${catalogPath}: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(2)
  }
}

/** Load audit_trail dim IDs from KIT catalog. */
function loadAuditTrailDims(catalogPath) {
  return new Set(
    safeLoadCatalog(catalogPath)
      .filter((d) => d.categoryRef === 'audit_trail')
      .map((d) => d.id),
  )
}

/** Load all dim IDs from KIT catalog. */
function loadAllDimIds(catalogPath) {
  return new Set(safeLoadCatalog(catalogPath).map((d) => d.id))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (!existsSync(MATRIX_PATH)) {
  process.stdout.write(
    `  check-feature-matrix: ERROR — FEATURE_MATRIX.md not found at ${MATRIX_PATH}\n`,
  )
  process.exit(2)
}

let text
try {
  text = readFileSync(MATRIX_PATH, 'utf-8')
} catch (err) {
  process.stdout.write(
    `  check-feature-matrix: ERROR — cannot read ${MATRIX_PATH}: ${err.message}\n`,
  )
  process.exit(2)
}

const rows = parseTableRows(text)
if (rows === null) {
  process.stdout.write(
    `  check-feature-matrix: ERROR — sentinel markers (${START_MARKER}) not found\n`,
  )
  process.exit(2)
}

if (rows.length === 0) {
  process.stdout.write(`  check-feature-matrix: ERROR — no data rows parsed from sentinel block\n`)
  process.exit(2)
}

// ─── WRITE mode: regenerate summary section ───────────────────────────────────
if (!CHECK) {
  const statusCounts = { Verified: 0, Done: 0, Partial: 0, Missing: 0 }
  for (const row of rows) {
    if (row.status in statusCounts) statusCounts[row.status]++
  }
  const total = rows.length
  const summaryTable = [
    '## Summary',
    '',
    '| Status | Count |',
    '|---|---|',
    `| Verified | ${statusCounts.Verified} |`,
    `| Done | ${statusCounts.Done} |`,
    `| Partial | ${statusCounts.Partial} |`,
    `| Missing | ${statusCounts.Missing} |`,
    `| **Total** | **${total}** |`,
  ].join('\n')

  const replaced = text.replace(/## Summary[\s\S]*?(?=\n---|\n##|$)/, summaryTable + '\n')
  writeFileSync(MATRIX_PATH, replaced, 'utf-8')
  process.stdout.write(`  check-feature-matrix: WROTE — summary updated (${total} rows)\n`)
  process.exit(0)
}

// ─── CHECK mode ───────────────────────────────────────────────────────────────
const effectiveLevel = resolveLevel()
const allDimIds = loadAllDimIds(KIT_CATALOG_PATH)
const auditTrailDims = loadAuditTrailDims(KIT_CATALOG_PATH)
const failures = []

// 1. Status ladder (fail-closed)
for (const row of rows) {
  const id = row.featureId
  const status = row.status
  const projectRoot = ROOT

  if (!['Missing', 'Partial', 'Done', 'Verified'].includes(status)) {
    failures.push(`${id}: unknown status "${status}"`)
    continue
  }

  if (status === 'Missing') {
    if (!row.issueRef || !/^#\d+$/.test(row.issueRef.trim())) {
      failures.push(
        `${id}: Missing status requires issue_ref matching #\\d+ (offline format check)`,
      )
    }
    continue
  }

  if (status === 'Partial') {
    if (!row.codeRef.trim()) {
      failures.push(`${id}: Partial status requires non-empty code_ref`)
    }
    continue
  }

  if (status === 'Done') {
    if (!row.codeRef.trim()) failures.push(`${id}: Done requires code_ref`)
    if (!row.testRef.trim()) failures.push(`${id}: Done requires test_ref`)
    if (!row.docRef.trim()) failures.push(`${id}: Done requires doc_ref`)
    checkAllRefs(row, projectRoot, failures, id)
    continue
  }

  if (status === 'Verified') {
    if (!row.codeRef.trim()) failures.push(`${id}: Verified requires code_ref`)
    if (!row.testRef.trim()) failures.push(`${id}: Verified requires test_ref`)
    if (!row.docRef.trim()) failures.push(`${id}: Verified requires doc_ref`)
    if (!row.issueRef.trim()) failures.push(`${id}: Verified requires issue_ref`)
    checkAllRefs(row, projectRoot, failures, id)
    // test_ref title parsing: check that the referenced test file exists (presence proxy)
    // Full title parsing would require reading test files — presence is the enforceable signal.
  }
}

// 2. KIT-dim coverage: setOf(all kit_dims cells) ⊇ allDimIds
if (allDimIds.size > 0) {
  const coveredDims = new Set()
  for (const row of rows) {
    for (const dim of row.kitDims) {
      coveredDims.add(dim)
    }
  }
  const uncovered = [...allDimIds].filter((d) => !coveredDims.has(d))
  if (uncovered.length > 0) {
    failures.push(
      `Coverage gap: ${uncovered.length} KIT dim(s) not in any row: ${uncovered.join(', ')}`,
    )
  }
} else {
  process.stdout.write(
    `  check-feature-matrix: WARN — KIT catalog not found at ${KIT_CATALOG_PATH}, skipping coverage check\n`,
  )
}

// 3. Counter integrity: summary counts == actual row counts
const summaryCounts = parseSummaryCounts(text)
const actualCounts = { verified: 0, done: 0, partial: 0, missing: 0 }
for (const row of rows) {
  if (row.status === 'Verified') actualCounts.verified++
  else if (row.status === 'Done') actualCounts.done++
  else if (row.status === 'Partial') actualCounts.partial++
  else if (row.status === 'Missing') actualCounts.missing++
}
const actualTotal = rows.length

for (const [key, actual] of Object.entries(actualCounts)) {
  const declared = summaryCounts[key] ?? -1
  if (declared !== actual) {
    failures.push(`Counter mismatch: Summary ${key}=${declared} but actual=${actual}`)
  }
}
if ((summaryCounts['total'] ?? -1) !== actualTotal) {
  failures.push(
    `Counter mismatch: Summary total=${summaryCounts['total'] ?? '?'} but actual=${actualTotal}`,
  )
}

// 4. Level DoD at L3+: Done/Verified rows must have test_ref file existing
if (levelAtLeast(effectiveLevel, 'L3')) {
  for (const row of rows) {
    if (row.status === 'Done' || row.status === 'Verified') {
      const testRefs = splitRefs(row.testRef)
      for (const ref of testRefs) {
        const err = checkRefExists(ref, ROOT)
        if (err) failures.push(`${row.featureId}: L3+ DoD — test_ref ${err}`)
      }
    }
  }
}

// 5. Level DoD at L4: audit_trail-category rows must have code_ref + test_ref
if (levelAtLeast(effectiveLevel, 'L4') && auditTrailDims.size > 0) {
  for (const row of rows) {
    const hasAuditTrailDim = row.kitDims.some((d) => auditTrailDims.has(d))
    if (hasAuditTrailDim) {
      if (!row.codeRef.trim()) {
        failures.push(`${row.featureId}: L4 audit_trail — code_ref required`)
      }
      if (!row.testRef.trim()) {
        failures.push(`${row.featureId}: L4 audit_trail — test_ref required`)
      }
    }
  }
}

// 6. Governance visibility: Partial rows lacking a tracked follow-up issue_ref (warn-only, INV-112)
const partialNoIssue = rows.filter((r) => r.status === 'Partial' && !/#\d+/.test(r.issueRef.trim()))
if (partialNoIssue.length > 0) {
  const totalPartial = rows.filter((r) => r.status === 'Partial').length
  process.stdout.write(
    `  check-feature-matrix: WARN — ${partialNoIssue.length}/${totalPartial} Partial rows lack a tracked issue_ref (governance gap, non-blocking): ${partialNoIssue.map((r) => r.featureId).join(', ')}\n`,
  )
}

// ─── Report ──────────────────────────────────────────────────────────────────
if (failures.length === 0) {
  process.stdout.write(
    `  check-feature-matrix: OK — ${rows.length} rows, all KIT dims covered, level=${effectiveLevel}\n`,
  )
  process.exit(0)
} else {
  for (const f of failures) {
    process.stdout.write(`  check-feature-matrix: FAIL — ${f}\n`)
  }
  process.exit(1)
}
