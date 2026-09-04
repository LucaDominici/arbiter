#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: validates docs/internal/PRODUCT/FEATURE_MATRIX.md status ladder, KIT-dim coverage, and level DoD.
// CATALOG: rejected fold-in into check-catalog-agents-parity.mjs (different domain: RTM vs invariant catalog).
// CATALOG: rejected fold-in into check-kit-catalog-parity.mjs (different concern: matrix gate vs catalog sync).
/**
 * check-feature-matrix.mjs — FEATURE_MATRIX.md gate (INV-112, CANON-23)
 *
 * Modes:
 *   --check (default)  validate status ladder, KIT-dim coverage, counter integrity, level DoD, verification_tier enum
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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { loadSchema, validateSchema } from './lib/agent-return-validate.mjs'

const ROOT = process.cwd()

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const UPDATE_BASELINE = args.includes('--update-baseline')
const CHECK = !args.includes('--write')
const _levelEqArg = args.find((a) => a.startsWith('--level='))?.split('=')[1] ?? null
const _levelIdx = args.indexOf('--level')
const _levelNextArg = _levelIdx >= 0 ? (args[_levelIdx + 1] ?? null) : null
const levelArg = _levelEqArg ?? (_levelNextArg?.match(/^L[1-4]$/) ? _levelNextArg : null)
const MATRIX_PATH = resolve(ROOT, 'docs', 'internal', 'PRODUCT', 'FEATURE_MATRIX.md')
const KIT_CATALOG_PATH = resolve(ROOT, 'src', 'kit', 'catalog.json')
const GLOB_BASELINE_PATH = resolve(ROOT, 'scripts', 'data', 'feature-matrix-glob-baseline.json')
const AGENTS_MD_PATH = resolve(ROOT, 'AGENTS.md')
const ADR_README_PATH = resolve(ROOT, 'docs', 'internal', 'ADR', 'README.md')
const PRD_PATH = resolve(ROOT, 'docs', 'PRODUCT', 'PRD.md')

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
    } catch (err) {
      process.stdout.write(
        `  check-feature-matrix: WARN — cannot parse arbiter.json at ${arbiterJsonPath}, defaulting to L2: ${err instanceof Error ? err.message : String(err)}\n`,
      )
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

/** Split a ref cell into RAW refs, anchors intact — the span check needs what normalizeRef drops. */
function splitRawRefs(cell) {
  if (!cell || !cell.trim()) return []
  return cell
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
}

// ─── Span-pinned refs: OUTDATED detection (#2480 wave 4, RTM axis 1) ─────────
//
// A citation by line number cannot survive the file being edited, and until now nothing checked
// it: normalizeRef strips `#L10-L20` before the existence test, so a span pointing past the end of
// the file — or at lines that have since become something else — left the row reading Verified.
// That is the "the requirement changed, the test did not" failure the RTM exists to catch.
//
// The grammar is `path#Lx-Ly` optionally followed by `@<12 hex>`, a sha256 prefix over the span's
// exact text. Both rules are ADDITIVE: a ref with no anchor behaves exactly as it did, so adoption
// is per-row and no existing row had to be rewritten to land this.
const SPAN_RE = /^(?<path>[^#]+)#L(?<from>\d+)-L(?<to>\d+)(?:@(?<pin>[0-9a-f]{12}))?$/

/** The pinned text of a span: lines from..to inclusive, joined with \n, no trailing newline. */
export function spanText(content, from, to) {
  return content
    .split('\n')
    .slice(from - 1, to)
    .join('\n')
}

/** 12 hex chars of sha256 over the span text — short enough to read in a table cell, long enough
 * that an accidental collision is not the explanation for a green row. */
export function spanPin(content, from, to) {
  return createHash('sha256')
    .update(spanText(content, from, to))
    .digest('hex')
    .slice(0, 12)
}

/**
 * Validate a raw ref's line span, if it carries one. Returns an error string or null.
 * A ref with no `#Lx-Ly` anchor is not this check's business and returns null.
 */
export function checkRefSpan(rawRef, projectRoot) {
  const m = SPAN_RE.exec(rawRef.trim())
  if (!m || !m.groups) return null
  const { path: relPath, pin } = m.groups
  const from = Number(m.groups['from']),
    to = Number(m.groups['to'])
  if (from < 1 || to < from) return `invalid line span (from > to, or zero): ${rawRef}`
  const abs = resolve(projectRoot, relPath)
  if (!existsSync(abs)) return null // absence is checkRefExists's finding, not a second report
  const content = readFileSync(abs, 'utf-8')
  const lines = content.split('\n').length
  if (to > lines) {
    return `line span runs past end of file (${lines} line(s)): ${rawRef}`
  }
  if (!pin) return null
  const actual = spanPin(content, from, to)
  if (actual !== pin) {
    return (
      `OUTDATED — the cited span no longer hashes to its pin, so the citation no longer proves ` +
      `what this row claims (pinned ${pin}, now ${actual}): ${rawRef}. ` +
      `Re-read the span, then re-pin with \`node scripts/check-feature-matrix.mjs --pin ${relPath}#L${from}-L${to}\``
    )
  }
  return null
}

// ─── --pin: produce a pinned ref, so a pin is computed and never hand-written ──
//
// Without a producer the pin syntax would be theatre: nobody hand-computes a sha256 prefix, so
// nobody would adopt it and the OUTDATED rule would guard an empty set. `--pin path#Lx-Ly` prints
// the ref to paste into the matrix cell.
{
  const pinIndex = args.indexOf('--pin')
  if (pinIndex >= 0) {
    const target = (args[pinIndex + 1] || '').trim()
    const m = /^([^#]+)#L(\d+)-L(\d+)(?:@[0-9a-f]{12})?$/.exec(target)
    if (!m) {
      process.stderr.write(
        `check-feature-matrix: --pin expects <path>#L<from>-L<to>, got "${target}"\n`,
      )
      process.exit(2)
    }
    const [, relPath, fromRaw, toRaw] = m
    const from = Number(fromRaw),
      to = Number(toRaw)
    const abs = resolve(process.cwd(), relPath)
    if (!existsSync(abs)) {
      process.stderr.write(`check-feature-matrix: --pin cannot read ${relPath}\n`)
      process.exit(2)
    }
    const content = readFileSync(abs, 'utf-8')
    const lines = content.split('\n').length
    if (from < 1 || to < from || to > lines) {
      process.stderr.write(
        `check-feature-matrix: --pin span L${from}-L${to} is outside ${relPath} (${lines} line(s))\n`,
      )
      process.exit(2)
    }
    process.stdout.write(`${relPath}#L${from}-L${to}@${spanPin(content, from, to)}\n`)
    process.exit(0)
  }
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

// ─── RTM axis 2: a Verified row must carry a verification envelope (#2480) ───
//
// `Verified` sat at the top of the status ladder as a word someone typed. The ladder refuses to
// skip a step and the refs must exist, but nothing ever checked that the requirement had been
// PROVEN — by running something, with a transcript. Same fail-closed hole INV-146 closed for
// milestone `done`: a status is not evidence.
//
// Citations reuse axis 1's pinned-span grammar, so a citation that drifts is reported OUTDATED by
// the same mechanism rather than a second one.
const RTM_EVIDENCE_DIR = ['.arbiter', 'evidence', 'rtm']
const RTM_BASELINE_REL = ['scripts', 'data', 'rtm-verdict-baseline.json']

/**
 * Read the monotone ratchet. Both failure modes resolve to 0 — tolerate nothing — because the
 * alternative, tolerating whatever happens to exist, is how a ratchet quietly stops ratcheting.
 * But ABSENT and CORRUPT are different claims and only one of them is routine: a missing baseline
 * is a project that has not needed one, while an unreadable baseline is a defect the operator
 * should hear about rather than discover as an unexplained strictness.
 */
function rtmBaseline(projectRoot) {
  const path = resolve(projectRoot, ...RTM_BASELINE_REL)
  if (!existsSync(path)) return 0
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    const n = raw?.verifiedWithoutEnvelope
    if (typeof n === 'number' && Number.isInteger(n) && n >= 0) return n
    process.stderr.write(
      `check-feature-matrix: rtm baseline has no integer verifiedWithoutEnvelope — treating as 0, ` +
        `which tolerates nothing\n`,
    )
    return 0
  } catch (err) {
    process.stderr.write(
      `check-feature-matrix: rtm baseline is unreadable (${err.message}) — treating as 0, which ` +
        `tolerates nothing\n`,
    )
    return 0
  }
}

/**
 * Validate one Verified row's envelope. Returns { failures, missing } — `missing` marks the row as
 * counting against the grandfathering ratchet rather than failing outright, so the four rows that
 * predate this rule are tolerated without inventing evidence for claims nobody recorded.
 */
export function checkRtmEnvelope(row, projectRoot, schema) {
  const id = row.featureId
  const path = resolve(projectRoot, ...RTM_EVIDENCE_DIR, `${id}.json`)
  if (!existsSync(path)) return { failures: [], missing: true }
  let doc
  try {
    doc = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    // Surfaced as well as returned: the returned string becomes the gate verdict, but the audit
    // (INV-96) reads a swallowed catch as fail-open, and it is right to — a reader of this code
    // should be able to see the error escape without tracing the caller's reporting.
    process.stderr.write(`check-feature-matrix: ${id} envelope parse failed — ${err.message}\n`)
    return {
      failures: [`${id}: verification envelope is not valid JSON — ${err.message}`],
      missing: false,
    }
  }
  return {
    failures: [
      ...validateSchema(doc, schema, schema, `${id} envelope`).map(
        (v) => `${id}: verification envelope — ${v}`,
      ),
      ...envelopeIdentityFailures(doc, id),
      ...envelopeCitationFailures(doc, id, projectRoot),
    ],
    missing: false,
  }
}

/** The envelope must be ABOUT this row, and must record the one verdict that admits `Verified`. */
function envelopeIdentityFailures(doc, id) {
  const failures = []
  if (doc?.feature_id && doc.feature_id !== id) {
    failures.push(
      `${id}: verification envelope declares feature_id "${doc.feature_id}" — evidence copied ` +
        `from another requirement proves that other requirement, not this one`,
    )
  }
  if (doc?.verdict && doc.verdict !== 'PROVEN') {
    failures.push(
      `${id}: status Verified requires verdict PROVEN, envelope records "${doc.verdict}"`,
    )
  }
  return failures
}

/** Citations ride axis 1's pinned-span grammar, so a drifted citation is OUTDATED, not a new rule. */
function envelopeCitationFailures(doc, id, projectRoot) {
  const failures = []
  for (const citation of Array.isArray(doc?.citations) ? doc.citations : []) {
    const err = checkRefSpan(String(citation), projectRoot)
    if (err) failures.push(`${id}: verification envelope citation — ${err}`)
  }
  return failures
}

/**
 * Apply the rule across the matrix and adjudicate the ratchet. A fall is free; a rise fails and
 * names both numbers, because the whole point of a monotone counter is that growth has to be
 * deliberate and visible in the diff.
 */
export function checkRtmEnvelopes(rows, projectRoot, schema) {
  const failures = []
  const uncovered = []
  for (const row of rows) {
    if (row.status !== 'Verified') continue
    const result = checkRtmEnvelope(row, projectRoot, schema)
    failures.push(...result.failures)
    if (result.missing) uncovered.push(row.featureId)
  }
  const baseline = rtmBaseline(projectRoot)
  if (uncovered.length > baseline) {
    // Name the rows. "N rows lack evidence" tells a reader there is work; naming them tells the
    // reader WHERE, which is the difference between a defect report and a statistic.
    failures.push(
      `RTM verdict ratchet: ${uncovered.length} Verified row(s) carry no verification envelope ` +
        `(${uncovered.join(', ')}), baseline ${baseline}. A Verified row needs ` +
        `.arbiter/evidence/rtm/<REQ-NNN>.json — status is not evidence. Falls are free; a rise ` +
        `must be hand-edited into scripts/data/rtm-verdict-baseline.json in the same change that ` +
        `earns it.`,
    )
  }
  return failures
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
    for (const raw of splitRawRefs(value)) {
      const err = checkRefSpan(raw, projectRoot)
      if (err) failures.push(`${id}: ${label} — ${err}`)
    }
  }
}

// ─── verification_tier enum (12th column, #2242) ────────────────────────────

/**
 * SCAFFOLD|GATE|E2E — GAMP IQ/OQ/PQ mapped to arbiter's real 3-tier V&V (see
 * "Verification tier" doc section). Validated whenever the cell is non-empty,
 * same backward-compatible optional-trailing-column posture as source_ref
 * (#2163) — an older 10/11-column matrix (no tier column at all) is unaffected.
 */
const TIER_VALUES = new Set(['SCAFFOLD', 'GATE', 'E2E'])

function checkVerificationTier(row, failures) {
  const tier = row.verificationTier.trim()
  if (!tier) return
  if (!TIER_VALUES.has(tier)) {
    failures.push(
      `${row.featureId}: verification_tier — invalid value "${tier}" (expected SCAFFOLD|GATE|E2E)`,
    )
  }
}

// ─── source_ref upward resolution (D1-D3, #2163) ────────────────────────────

/**
 * Split a source_ref cell into individual anchors. Deliberately NOT
 * normalizeRef/splitRefs (D1): those strip trailing `#...`/`:\d+` file-ref
 * suffixes, which would silently mangle an issue-form anchor (`#123`) into
 * an empty string for the wrong reason.
 */
function splitSourceRefs(cell) {
  if (!cell || !cell.trim()) return []
  return cell
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Classify a source_ref anchor into one of the three canonical resolvable
 * forms (D2). Anything else (issue form `#NNN`, free prose, an unrecognized
 * numbering scheme) is `kind: null` — format-only, never resolved, never a
 * false red (AC-3).
 */
function classifySourceAnchor(anchor) {
  let m
  if ((m = /^INV-(\d+)$/.exec(anchor))) return { kind: 'inv', num: m[1] }
  if ((m = /^ADR-(\d+)$/.exec(anchor))) return { kind: 'adr', num: m[1] }
  if ((m = /^PRD\s*§\s*(\d+(?:\.\d+)*)$/.exec(anchor))) return { kind: 'prd', num: m[1] }
  return { kind: null }
}

let _agentsMdCache
function readAgentsMdOnce() {
  if (_agentsMdCache === undefined) {
    _agentsMdCache = existsSync(AGENTS_MD_PATH) ? readFileSync(AGENTS_MD_PATH, 'utf-8') : null
  }
  return _agentsMdCache
}

let _adrReadmeCache
function readAdrReadmeOnce() {
  if (_adrReadmeCache === undefined) {
    _adrReadmeCache = existsSync(ADR_README_PATH) ? readFileSync(ADR_README_PATH, 'utf-8') : null
  }
  return _adrReadmeCache
}

let _prdCache
function readPrdOnce() {
  if (_prdCache === undefined) {
    _prdCache = existsSync(PRD_PATH) ? readFileSync(PRD_PATH, 'utf-8') : null
  }
  return _prdCache
}

/** heading text (post `#+` strip) starts with the numeric anchor, e.g. "5.7 Foo" for anchor "5.7". */
function prdHasNumberedHeading(text, num) {
  const escaped = num.replace(/\./g, '\\.')
  const headingRe = new RegExp(`^${escaped}\\.?(\\s|$)`)
  return text.split('\n').some((line) => {
    const m = /^#+\s*(.*)$/.exec(line.trim())
    return m !== null && headingRe.test(m[1].trim())
  })
}

/**
 * Resolve one source_ref anchor against its target document (D3's internal
 * path column) and push a failure naming the row and anchor on a miss
 * (AC-1). No-op for non-canonical anchors (D2/AC-3).
 *
 * ponytail: internal-only doc paths/formats (AGENTS.md bullet, ADR README
 * index table, docs/PRODUCT/PRD.md numbered headings) — a target project
 * with a genuinely different convention needs a configurable path/format
 * (arbiter.json), out of scope here (arbiter's own two scripts only).
 */
function checkSourceRefAnchor(anchor, id, failures) {
  const classified = classifySourceAnchor(anchor)
  if (classified.kind === null) return

  const failure = sourceAnchorFailure(classified, anchor, id)
  if (failure !== null) failures.push(failure)
}

function sourceAnchorFailure(classified, anchor, id) {
  const { kind, num } = classified
  const checks = {
    inv: () => {
      const text = readAgentsMdOnce()
      return text !== null && text.includes(`**INV-${num}:**`)
    },
    adr: () => {
      const text = readAdrReadmeOnce()
      return text !== null && new RegExp(`^\\|\\s*0*${num}\\s*\\|`, 'm').test(text)
    },
    prd: () => {
      const text = readPrdOnce()
      return text !== null && prdHasNumberedHeading(text, num)
    },
  }
  const descriptions = {
    inv: `no matching **INV-${num}:** entry in AGENTS.md`,
    adr: 'no matching ADR index row in docs/internal/ADR/README.md',
    prd: `no matching "${num}" heading in docs/PRODUCT/PRD.md`,
  }
  return checks[kind]() ? null : `${id}: source_ref ${anchor} — ${descriptions[kind]}`
}

// ─── tests_ref glob ban (D4, #2163) ──────────────────────────────────────────

/** Load the committed glob-ratchet baseline as a Set of "featureId::ref" keys. Missing file → empty (no grandfathering). Corrupt JSON → exit 2. */
function loadGlobBaseline(path) {
  if (!existsSync(path)) return new Set()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    return new Set(Array.isArray(raw?.entries) ? raw.entries : [])
  } catch (err) {
    process.stdout.write(
      `  check-feature-matrix: ERROR — cannot read/parse glob baseline at ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(2)
  }
}

/**
 * A glob test_ref matches always, making forward coverage infalsifiable.
 * Verified rows are NEVER baseline-exemptible (D4) — the one rule that
 * actually closes the class of bug #2163 describes. Only Done rows can be
 * grandfathered via a committed baseline entry keyed `${featureId}::${ref}`.
 */
function checkTestRefGlobBan(rows, baselineSet, failures) {
  for (const row of rows) {
    if (row.status !== 'Done' && row.status !== 'Verified') continue
    for (const ref of splitRefs(row.testRef)) {
      if (!ref.includes('*')) continue
      if (row.status === 'Verified') {
        failures.push(
          `${row.featureId}: test_ref glob ban — Verified status forbids a glob test_ref (never baseline-exemptible): ${ref}`,
        )
        continue
      }
      const key = `${row.featureId}::${ref}`
      if (!baselineSet.has(key)) {
        failures.push(
          `${row.featureId}: test_ref glob ban — new glob test_ref not in baseline: ${ref}`,
        )
      }
    }
  }
}

/** Recompute the glob baseline from current Done-status glob test_refs, sorted, deterministic. */
function computeGlobBaseline(rows) {
  const entries = []
  for (const row of rows) {
    if (row.status !== 'Done') continue
    for (const ref of splitRefs(row.testRef)) {
      if (ref.includes('*')) entries.push(`${row.featureId}::${ref}`)
    }
  }
  entries.sort()
  return entries
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
    // 11th column, optional (D1): today's 10-column rows already produce a
    // trailing empty cell artifact at this index (verified empirically), so
    // this is backward compatible with every existing row — zero migration.
    const sourceRef = cells[10] ?? ''
    // 12th column, optional (#2242): same backward-compat posture as source_ref.
    const verificationTier = cells[11] ?? ''

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
      sourceRef,
      verificationTier,
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

// ─── --update-baseline: its own top-level action (D4), checked before --write ──
if (UPDATE_BASELINE) {
  const entries = computeGlobBaseline(rows)
  const payload = {
    schema: 'arbiter-feature-matrix-glob-baseline-v1',
    generated_at: new Date().toISOString(),
    doctrine:
      'INV-112 / #2163 — grandfathered Done-status test_ref globs at baseline freeze. ' +
      'Verified rows are NEVER exemptible (a promoted-to-Verified glob is always a FAIL). ' +
      'Regenerate deliberately with `node scripts/check-feature-matrix.mjs --update-baseline`.',
    entries,
  }
  mkdirSync(dirname(GLOB_BASELINE_PATH), { recursive: true })
  writeFileSync(GLOB_BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
  process.stdout.write(
    `  check-feature-matrix: baseline updated → ${GLOB_BASELINE_PATH} (${entries.length} entries)\n`,
  )
  process.exit(0)
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

  // source_ref upward resolution (D1): validated whenever the cell is
  // non-empty, regardless of row status — a stale source anchor is a real
  // defect on a Partial row too, not just a promotion-gated one.
  for (const anchor of splitSourceRefs(row.sourceRef)) {
    checkSourceRefAnchor(anchor, id, failures)
  }

  // verification_tier enum (#2242): same posture as source_ref — checked
  // whenever non-empty, independent of status ladder outcome below.
  checkVerificationTier(row, failures)

  // AC-1 (#2413): ref existence is checked for EVERY status whenever a
  // code_ref/test_ref/doc_ref cell is non-empty, not just Done/Verified — a
  // stale ref on a Partial row (the audit's REQ-044/REQ-054 defects) is just
  // as false as one on a Done row.
  checkAllRefs(row, projectRoot, failures, id)

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
    continue
  }

  if (status === 'Verified') {
    if (!row.codeRef.trim()) failures.push(`${id}: Verified requires code_ref`)
    if (!row.testRef.trim()) failures.push(`${id}: Verified requires test_ref`)
    if (!row.docRef.trim()) failures.push(`${id}: Verified requires doc_ref`)
    if (!row.issueRef.trim()) failures.push(`${id}: Verified requires issue_ref`)
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

// 7. tests_ref glob ban (D4, #2163): infalsifiable glob coverage on Done/Verified rows
const globBaseline = loadGlobBaseline(GLOB_BASELINE_PATH)
checkTestRefGlobBan(rows, globBaseline, failures)

// 8. RTM axis 2 (#2480): a Verified row must carry a PROVEN verification envelope. The schema
// lives beside the gate in arbiter; a governed project receives its own copy. Absent schema is an
// ERROR, never a silent skip — a rule that quietly stops applying is the failure this gate exists
// to prevent.
{
  const schemaPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'schemas',
    'rtm-verdict.schema.json',
  )
  if (existsSync(schemaPath)) {
    failures.push(...checkRtmEnvelopes(rows, ROOT, loadSchema(schemaPath)))
  } else if (rows.some((row) => row.status === 'Verified')) {
    failures.push(
      'RTM axis 2: schemas/rtm-verdict.schema.json is missing, so no Verified row can be ' +
        'adjudicated. Restore it rather than letting the rule lapse silently.',
    )
  }
}

// ─── Report ──────────────────────────────────────────────────────────────────
failures.sort() // D5: deterministic output regardless of row order

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
