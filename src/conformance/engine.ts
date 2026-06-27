// SPDX-License-Identifier: Apache-2.0
// conformance/engine.ts — typed TS port of scripts/lib/gold-audit-lib.mjs (#1393).
//
// Determinism contract: identical repo + identical registry ⇒ identical evaluate() output.
// Checks are evaluated in stable id order; no wall-clock value enters the scored payload.
// Parity gate: engine-parity.test.ts asserts deep-equal verdicts/score/yCount vs the .mjs.

import { existsSync, statSync, lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  safeResolve,
  readText,
  readScanText,
  expandGlob,
  walkRepo,
  hasNestedUnboundedQuantifier,
  MAX_SCAN_BYTES,
} from './shared.js'

/** Deterministic, locale-independent string order (UTF-16 code units) — byte-identical with the
 * .mjs engine and immune to Node/ICU collation drift (#1471). Used for every check/dimension sort. */
function cmpCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// ── #1413: brownfield-class threshold SSOT + value-op report-extraction model ───
//
// A `value` check with an `args.format` reads a PRE-GENERATED tool report deterministically (no
// live spawn: that would break the determinism + parity + fail-closed contracts). It extracts a
// single numeric metric (json dotted-path, xml element-count / attribute, or a regex capture group)
// and compares it against a bar resolved per brownfield class via `threshold_ref`. A check whose
// report file is ABSENT resolves to NA (the tool did not run / does not apply) — never a false-N.

// ── Public types ──────────────────────────────────────────────────────────────

/** Unified verdict scale: Y=pass, P=partial, N=fail, NA=not-applicable, NV=not-verified. */
export type Verdict = 'Y' | 'P' | 'N' | 'NA' | 'NV'

/** Deterministic evidence reference — file path + optional line + optional detail. */
export interface Evidence {
  file: string
  line?: number
  detail?: string
}

/**
 * A registry is YAML-loaded, so a field that *should* be a string can arrive as a bare numeric
 * scalar (`version: 1.0`, `weight: 2`, `pattern: 7`). These fields are typed `string | number` —
 * not `string` — so the engine's String()/Number() coercions are genuinely necessary (and the two
 * engines stay byte-identical on mistyped input). Stringifying a `string | number` is always safe.
 */
type RawScalar = string | number

/**
 * Generic `applies_if` precondition (G1). When the precondition is MET the check is evaluated; when
 * UNMET the check is NA (excluded from the score denominator). FAIL-SAFE: an unknown `type`, or a
 * precondition missing a required field / with an invalid path, makes the check APPLY (never a
 * silent skip — that would be a false-green).
 *   file_exists    — met when `path` resolves to an existing file
 *   file_contains  — met when the file at `path` contains the literal `pattern`
 *   count_matches  — met when `path` contains `pattern` at least `min` (default 1) times
 *   capability     — met when `name` is in the active overlay set (object form of the legacy string)
 */
interface PreconditionInput {
  type?: RawScalar
  path?: RawScalar
  pattern?: RawScalar
  min?: RawScalar
  name?: RawScalar
}

interface CheckInput {
  id: RawScalar
  /** Optional at the type level: a malformed registry can omit it ⇒ scored as an unknown-type N. */
  type?: RawScalar
  args?: {
    path?: RawScalar
    pattern?: RawScalar
    min?: RawScalar
    equals?: RawScalar
    /** value-op report extraction format (#1413): 'json' | 'xml' | 'regex' (mistyped ⇒ no metric). */
    format?: RawScalar
    /** value-op selector: json dotted-path | xml `count:tag` / `attr:tag@attr` | regex w/ group 1. */
    select?: RawScalar
    /** value-op comparison operator (#1413): 'gte' | 'lte' | 'eq'. */
    op?: RawScalar
    /** value-op literal bar (used only when no `threshold_ref` is given). */
    expected?: RawScalar
    [key: string]: unknown
  }
  weight?: RawScalar
  /**
   * Conditional gating. A bare string is an overlay/capability name (legacy form: NA when the
   * overlay is disabled). An object is a generic precondition (G1) — see {@link PreconditionInput}.
   */
  applies_if?: string | PreconditionInput
  dimension?: RawScalar
  title?: RawScalar
  risk?: string
  anchor?: RawScalar
  /** Resolve the comparison bar per brownfield class from the thresholds SSOT (#1413). */
  threshold_ref?: string
}

export interface RegistryInput {
  version?: RawScalar
  checks?: CheckInput[]
}

/** Per-class numeric bar for one threshold_ref key (the thresholds.yml row). */
type ThresholdRow = Record<string, number>
/** The brownfield-class threshold SSOT: threshold_ref → { gold, light, medium, heavy }. */
type ThresholdTable = Record<string, ThresholdRow>

/** Optional evaluation context: thresholds SSOT + the active brownfield class (#1413). */
export interface EvaluateOptions {
  thresholds?: ThresholdTable
  brownfieldClass?: string
}

interface CheckResult {
  id: string
  dimension: string
  title: string
  type: string
  verdict: Verdict
  weight: number
  risk: string
  anchor: string | null
  evidence: Evidence | null
}

export interface EngineResult {
  registryVersion: string
  score: number
  yCount: number
  riskyCount: number
  totals: { checks: number; y: number; p: number; n: number; na: number; nv: number }
  dimensions: Record<string, { score: number; y: number }>
  checks: CheckResult[]
}

export interface Baseline {
  score: number
  yCount: number
  dimensions: Record<string, { score: number; y: number }>
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Evidence detail for an unresolvable / non-string / traversal path (shared across check types). */
const INVALID_PATH = 'invalid path'

type EvalCheckResult = { verdict: Verdict; evidence: Evidence | null }

/** 1-based line number of the first occurrence of `needle` in `text`, or null. */
function lineOf(text: string, needle: string): number | null {
  const idx = text.indexOf(needle)
  if (idx < 0) return null
  let line = 1
  for (let i = 0; i < idx; i++) if (text[i] === '\n') line++
  return line
}

/** 1-based line number of the character at `idx` in `text`. */
function lineAtIndex(text: string, idx: number): number {
  let line = 1
  for (let i = 0; i < idx && i < text.length; i++) if (text[i] === '\n') line++
  return line
}

/** Numeric verdict weight: Y=1, P=0.5, N=0; NA/NV excluded from denominator. */
function verdictPoints(verdict: Verdict): number {
  if (verdict === 'Y') return 1
  if (verdict === 'P') return 0.5
  return 0
}

// ── Per-type check evaluators ─────────────────────────────────────────────────

function evalFileExists(abs: string, rel: string): EvalCheckResult {
  if (!existsSync(abs)) return { verdict: 'N', evidence: { file: rel, detail: 'missing' } }
  try {
    if (statSync(abs).isDirectory())
      return { verdict: 'N', evidence: { file: rel, detail: 'is a directory' } }
  } catch {
    return { verdict: 'N', evidence: { file: rel, detail: 'unreadable' } }
  }
  return { verdict: 'Y', evidence: { file: rel } }
}

function evalFileContains(abs: string, rel: string, pattern: string): EvalCheckResult {
  // An empty/missing pattern is a registry authoring error, never a satisfied property: `''.indexOf`
  // matches at index 0 of any readable file, so an omitted `pattern` would fake-green a verified-Y
  // with zero evidence that anything is present. Refuse it — mirrors evalForbiddenPattern's
  // empty-pattern N so the anti-fake-green contract is uniform across check types (#1591).
  if (pattern === '') {
    return { verdict: 'N', evidence: { file: rel, detail: 'empty or missing pattern' } }
  }
  const text = readText(abs)
  if (text === null) return { verdict: 'N', evidence: { file: rel, detail: 'missing' } }
  const line = lineOf(text, pattern)
  return line !== null
    ? { verdict: 'Y', evidence: { file: rel, line } }
    : { verdict: 'N', evidence: { file: rel, detail: `pattern not found: ${pattern}` } }
}

/** Count non-overlapping occurrences of `pattern` in `text` (0 for an empty pattern). */
function countOccurrences(text: string, pattern: string): number {
  if (pattern.length === 0) return 0
  let count = 0
  let from = 0
  for (;;) {
    const i = text.indexOf(pattern, from)
    if (i < 0) break
    count++
    from = i + pattern.length
  }
  return count
}

function evalCountMatches(
  abs: string,
  rel: string,
  pattern: string,
  want: number,
): EvalCheckResult {
  const text = readText(abs)
  if (text === null) return { verdict: 'N', evidence: { file: rel, detail: 'missing' } }
  const count = countOccurrences(text, pattern)
  if (count >= want) return { verdict: 'Y', evidence: { file: rel, detail: `count=${count}` } }
  if (count > 0) return { verdict: 'P', evidence: { file: rel, detail: `count=${count}/${want}` } }
  return { verdict: 'N', evidence: { file: rel, detail: `count=0/${want}` } }
}

function evalValue(abs: string, rel: string, expected: string): EvalCheckResult {
  // Same empty-needle hole as evalFileContains: `''.indexOf` matches line 1 of any readable file, so
  // a value check that omits `equals` would fake-green to Y with no evidence. Refuse it (#1591).
  if (expected === '') {
    return { verdict: 'N', evidence: { file: rel, detail: 'empty or missing pattern' } }
  }
  const text = readText(abs)
  if (text === null) return { verdict: 'N', evidence: { file: rel, detail: 'missing' } }
  const line = lineOf(text, expected)
  return line !== null
    ? { verdict: 'Y', evidence: { file: rel, line } }
    : { verdict: 'N', evidence: { file: rel, detail: `value not present: ${expected}` } }
}

// ── #1413: deterministic report metric extraction (json/xml/regex) ──────────────

/** Read a numeric metric from a JSON report via a dotted path (e.g. `total.lines.pct`), or null. */
function extractJson(text: string, select: string): number | null {
  let node: unknown
  try {
    node = JSON.parse(text)
  } catch {
    return null
  }
  const keys = select.split('.').filter((k) => k !== '')
  for (const [i, key] of keys.entries()) {
    // A null/absent collection has zero elements: a TERMINAL `length` selector over a null/undefined
    // node resolves to 0, not "no metric". golangci-lint marshals a nil (zero-issue) issue slice to
    // JSON `null`, so a CLEAN Go lint run reads `Issues.length` = 0 ≤ ceiling (Y) instead of N "no
    // metric for json:Issues.length" — the asymmetry that only bit the passing case (#1569).
    if (key === 'length' && i === keys.length - 1 && (node === null || node === undefined)) {
      return 0
    }
    if (node === null || typeof node !== 'object') return null
    node = (node as Record<string, unknown>)[key]
  }
  const n = typeof node === 'number' ? node : Number(node)
  return Number.isFinite(n) ? n : null
}

/**
 * Read a numeric metric from an XML report. Selectors (deterministic, dependency-free):
 *   `count:tag`        → number of `<tag` occurrences (open or self-closing)
 *   `attr:tag@name`    → the numeric `name="…"` attribute of the first `<tag …>` element
 */
// A real element open ends in whitespace, '>' or '/' (not another name char).
function isXmlElementBoundary(c: string | undefined): boolean {
  return (
    c === undefined || c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '>' || c === '/'
  )
}

// Index of the Nth `<tag` whose next char ends the element name (a real open, never a tag PREFIX),
// or -1. `nth < 0` ⇒ count all such opens instead. Shared by `count:` and `attr:` so the
// prefix-boundary guard lives once: a bare indexOf('<cov') would match `<coverage` and read the
// wrong element. Returns the index when nth>=0, or the total count when nth<0.
function scanElementOpens(text: string, tag: string, nth: number): number {
  const needle = `<${tag}`
  let count = 0
  let from = 0
  for (;;) {
    const i = text.indexOf(needle, from)
    if (i < 0) break
    if (isXmlElementBoundary(text[i + needle.length])) {
      if (nth >= 0 && count === nth) return i
      count++
    }
    from = i + needle.length
  }
  return nth >= 0 ? -1 : count
}

function extractXmlAttr(text: string, spec: string): number | null {
  const at = spec.indexOf('@')
  if (at < 0) return null
  const tag = spec.slice(0, at)
  const attr = spec.slice(at + 1)
  if (tag === '' || attr === '') return null
  // Read from the FIRST boundary-valid `<tag` open — never a tag prefix.
  const open = scanElementOpens(text, tag, 0)
  if (open < 0) return null
  const close = text.indexOf('>', open)
  const segment = close < 0 ? text.slice(open) : text.slice(open, close)
  // Guard the attr RegExp build: a regex metachar in the attr name (`attr:a@(`) would otherwise
  // throw and (via the top-level catch) zero the whole registry — yield a per-check N instead.
  // The bare try/catch traps only invalid SYNTAX, so reject the catastrophic-backtracking family
  // FIRST (matching this file's 3 other dynamic-RegExp sites) lest a valid `(a+)+`-shaped attr
  // name hang the audit instead of throwing (#1551).
  if (hasNestedUnboundedQuantifier(attr)) return null
  let m: RegExpExecArray | null
  try {
    m = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`).exec(segment)
  } catch {
    return null
  }
  if (m === null) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** Parse one `<tag …>` element segment's `name="value"` pairs into a map (fixed regex, ReDoS-safe). */
function parseXmlAttrs(segment: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(segment)) !== null) attrs[m[1] as string] = m[2] as string
  return attrs
}

/**
 * Coverage PERCENT from a JaCoCo-style report's report-TOTAL counter: the LAST
 * `<counter type="<TYPE>" missed="M" covered="C"/>` element (JaCoCo emits counters in
 * method → class → package → report order, so the report total is last in document order),
 * computed as C*100/(C+M). Selecting the LAST match — not the leftmost — and dividing covered by
 * the total is what makes this a real coverage RATIO instead of one arbitrary method's raw
 * covered-line COUNT (#1629). Null when no such counter exists, an attr is missing/non-numeric, or
 * the total is 0 (0/0 asserts no coverage). `(C*100)/total` keeps clean integers exactly representable.
 */
function extractCoveragePercent(text: string, counterType: string): number | null {
  const needle = '<counter'
  let from = 0
  let covered = 0
  let missed = 0
  let found = false
  for (;;) {
    const i = text.indexOf(needle, from)
    if (i < 0) break
    from = i + needle.length
    if (!isXmlElementBoundary(text[i + needle.length])) continue
    const close = text.indexOf('>', i)
    const segment = close < 0 ? text.slice(i) : text.slice(i, close)
    const attrs = parseXmlAttrs(segment)
    if (attrs['type'] !== counterType) continue
    const c = Number(attrs['covered'])
    const m = Number(attrs['missed'])
    if (!Number.isFinite(c) || !Number.isFinite(m)) continue
    covered = c
    missed = m
    found = true
  }
  if (!found) return null
  const total = covered + missed
  if (total <= 0) return null
  return (covered * 100) / total
}

/**
 * Read a numeric metric from an XML report. Selectors (deterministic, dependency-free):
 *   `count:tag`        → number of `<tag` occurrences (open or self-closing)
 *   `attr:tag@name`    → the numeric `name="…"` attribute of the first `<tag …>` element
 *   `coverage:TYPE`    → report-total coverage PERCENT of the LAST `<counter type="TYPE">` (#1629)
 */
function extractXml(text: string, select: string): number | null {
  if (select.startsWith('count:')) {
    const tag = select.slice('count:'.length)
    if (tag === '') return null
    return scanElementOpens(text, tag, -1)
  }
  if (select.startsWith('attr:')) {
    return extractXmlAttr(text, select.slice('attr:'.length))
  }
  if (select.startsWith('coverage:')) {
    const counterType = select.slice('coverage:'.length)
    if (counterType === '') return null
    return extractCoveragePercent(text, counterType)
  }
  return null
}

/** Read a numeric metric from text via a regex whose first capture group is the number. */
function extractRegex(text: string, select: string): number | null {
  // Reject catastrophic-backtracking patterns (#1525) — a valid-syntax ReDoS regex would otherwise
  // hang on adversarial report text; the surrounding try/catch only catches invalid syntax.
  if (hasNestedUnboundedQuantifier(select)) return null
  let re: RegExp
  try {
    re = new RegExp(select)
  } catch {
    return null
  }
  const m = re.exec(text)
  if (m === null || m[1] === undefined) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/**
 * Total statement (≈ line) coverage PERCENT from a Go `go test -coverprofile` profile — the real
 * artifact arbiter emits (there is no Go coverage.json). Each data line is
 * `file.go:sl.sc,el.ec numStmt hitCount`; sum numStmt over all blocks and over the hit subset, then
 * coveredStmts*100/totalStmts — exactly what `go tool cover -func` reports as total (#1629).
 * Deterministic + dependency-free. Null when the profile has no data block or zero total statements.
 */
function extractGoCoverProfile(text: string): number | null {
  let total = 0
  let covered = 0
  let sawBlock = false
  for (const raw of text.split('\n')) {
    const m = /:\d+\.\d+,\d+\.\d+\s+(\d+)\s+(\d+)\s*$/.exec(raw)
    if (m === null) continue
    const numStmt = Number(m[1])
    const hits = Number(m[2])
    if (!Number.isFinite(numStmt) || !Number.isFinite(hits)) continue
    total += numStmt
    if (hits > 0) covered += numStmt
    sawBlock = true
  }
  if (!sawBlock || total <= 0) return null
  return (covered * 100) / total
}

/** Extract a numeric metric from a report's text for the given format + selector, or null. */
function extractMetric(text: string, format: string, select: string): number | null {
  if (format === 'json') return extractJson(text, select)
  if (format === 'xml') return extractXml(text, select)
  if (format === 'regex') return extractRegex(text, select)
  if (format === 'go-coverprofile') return extractGoCoverProfile(text)
  return null
}

/** Apply a comparison operator. Unknown op fails closed (false). */
function compareValue(actual: number, op: string, bar: number): boolean {
  if (op === 'gte') return actual >= bar
  if (op === 'lte') return actual <= bar
  if (op === 'eq') return actual === bar
  return false
}

/**
 * Resolve the comparison bar for a value check: `threshold_ref` row keyed by the active brownfield
 * class, else the literal `args.expected`. Returns null when neither yields a finite number.
 */
function resolveBar(check: CheckInput, options: EvaluateOptions): number | null {
  const ref = check.threshold_ref
  if (ref !== undefined && ref !== '') {
    const table = options.thresholds ?? {}
    const row = table[ref]
    if (row === undefined) return null
    const cls = options.brownfieldClass ?? 'gold'
    const bar = Object.prototype.hasOwnProperty.call(row, cls) ? row[cls] : undefined
    return typeof bar === 'number' && Number.isFinite(bar) ? bar : null
  }
  const lit = check.args?.expected
  return typeof lit === 'number' && Number.isFinite(lit) ? lit : null
}

/**
 * value-op report-extraction evaluator (#1413). Reads a pre-generated tool report; absent report ⇒
 * NA (no false-N). Bar resolved per brownfield class via threshold_ref / args.expected.
 */
function evalValueReport(
  abs: string,
  rel: string,
  check: CheckInput,
  options: EvaluateOptions,
): EvalCheckResult {
  // Absent report ⇒ NA: the tool did not run / does not apply for this stack (never a false-N).
  if (!existsSync(abs)) return { verdict: 'NA', evidence: null }
  const args = check.args ?? {}
  // String()-coerce — a numeric select from an unquoted YAML scalar would otherwise throw in
  // extractJson/extractXml and (via the top-level catch) zero the WHOLE registry. Mirrors the .mjs.
  const format = String(args.format ?? '')
  const select = String(args.select ?? '')
  const op = String(args.op ?? '')
  const bar = resolveBar(check, options)
  if (bar === null) {
    return { verdict: 'N', evidence: { file: rel, detail: 'unresolved threshold' } }
  }
  // Capped read (#1525): a regex-format report is fed to a registry regex — bound the bytes it sees.
  const read = readScanText(abs)
  if (!read.ok) {
    const detail = read.reason === 'oversize' ? 'report too large to scan' : 'unreadable'
    return { verdict: 'N', evidence: { file: rel, detail } }
  }
  const text = read.text
  const actual = extractMetric(text, format, select)
  if (actual === null) {
    return { verdict: 'N', evidence: { file: rel, detail: `no metric for ${format}:${select}` } }
  }
  const pass = compareValue(actual, op, bar)
  return pass
    ? { verdict: 'Y', evidence: { file: rel, detail: `${actual} ${op} ${bar}` } }
    : { verdict: 'N', evidence: { file: rel, detail: `${actual} !${op} ${bar}` } }
}

// ── version_consistency: a VERSION file ↔ the latest CHANGELOG entry ─────────────
// Mirror of scripts/lib/gold-audit-lib.mjs (parity contract). Pure text read + one regex.

/** First capture group of `pattern` (multiline) in `text` = the latest declared version, or null. */
function latestChangelogVersion(text: string, pattern: unknown): string | null {
  if (typeof pattern !== 'string' || pattern === '') return null
  // Reject catastrophic-backtracking patterns (#1525) before running over the full changelog text.
  if (hasNestedUnboundedQuantifier(pattern)) return null
  let re: RegExp
  try {
    re = new RegExp(pattern, 'm')
  } catch {
    return null
  }
  const m = re.exec(text)
  // A falsy/empty capture is NOT a version — return null so the caller scores P (indeterminate),
  // never a false Y (e.g. an empty trimmed VERSION === an empty capture).
  return m !== null && m[1] ? m[1] : null
}

/**
 * Read a STRING value from a JSON document via a dotted path (e.g. `version` in package.json), or
 * null when the text is not JSON / the path is absent / the value is not a non-empty string. The
 * string twin of extractJson — a non-string field is never coerced (so a missing version scores P,
 * never a false Y).
 */
function extractJsonString(text: string, select: string): string | null {
  let node: unknown
  try {
    node = JSON.parse(text)
  } catch {
    return null
  }
  for (const key of select.split('.')) {
    if (key === '') continue
    if (node === null || typeof node !== 'object') return null
    node = (node as Record<string, unknown>)[key]
  }
  return typeof node === 'string' && node !== '' ? node : null
}

/**
 * version_consistency evaluator. Y = the declared version equals the latest CHANGELOG entry; P =
 * both present but divergent OR no changelog entry matches the pattern OR the version is
 * indeterminate (indeterminate — never a false Y); N = a required file is missing/unreadable.
 * The version comes from a plain-text file (trimmed) or, when `version_select` is set, from a
 * dotted JSON path inside `version_file` (e.g. version_file: package.json, version_select: version).
 */
function evalVersionConsistency(args: Record<string, unknown>, root: string): EvalCheckResult {
  const vFile = typeof args['version_file'] === 'string' ? args['version_file'] : ''
  const cFile = typeof args['changelog_file'] === 'string' ? args['changelog_file'] : ''
  const vSelect = typeof args['version_select'] === 'string' ? args['version_select'] : ''
  const vAbs = safeResolve(root, vFile)
  const cAbs = safeResolve(root, cFile)
  if (vAbs === null || cAbs === null) {
    return { verdict: 'N', evidence: { file: vFile || cFile, detail: INVALID_PATH } }
  }
  const vText = readText(vAbs)
  if (vText === null)
    return { verdict: 'N', evidence: { file: vFile, detail: 'missing version file' } }
  // Capped read (#1525): the changelog is fed to a registry regex — bound the bytes it runs over.
  const cRead = readScanText(cAbs)
  if (!cRead.ok) {
    const detail = cRead.reason === 'oversize' ? 'changelog too large to scan' : 'missing changelog'
    return { verdict: 'N', evidence: { file: cFile, detail } }
  }
  const cText = cRead.text
  const version = vSelect !== '' ? extractJsonString(vText, vSelect) : vText.trim()
  if (version === null) {
    return { verdict: 'P', evidence: { file: vFile, detail: `no ${vSelect} in version file` } }
  }
  if (version === '') {
    return { verdict: 'P', evidence: { file: vFile, detail: 'empty version file' } }
  }
  const latest = latestChangelogVersion(cText, args['changelog_pattern'])
  if (latest === null) {
    return {
      verdict: 'P',
      evidence: { file: cFile, detail: 'no changelog entry matches the pattern' },
    }
  }
  if (version === latest) {
    return { verdict: 'Y', evidence: { file: vFile, detail: `${version} == ${latest}` } }
  }
  return {
    verdict: 'P',
    evidence: { file: cFile, detail: `VERSION ${version} != CHANGELOG ${latest}` },
  }
}

// ── forbidden_pattern: a regex that must NOT appear in any file under a glob (#1470) ──
// Mirror of scripts/lib/gold-audit-lib.mjs (parity contract). Anti-fake-green ladder (top-down):
//   empty/non-string pattern ⇒ N · invalid regex ⇒ N · invalid/empty glob ⇒ N ·
//   exclude entry with a glob char ⇒ N (literal-only) · exclude_paths set w/o rationale ⇒ N ·
//   glob matched 0 files ⇒ NA · excludes removed ALL matched files ⇒ N (refuse fake-green) ·
//   pattern found ⇒ N (first SORTED file + line) · absent across every scanned file ⇒ Y.

/** Resolved glob: a sorted match list, or a verified-N result when the glob is invalid/empty. */
type GlobResolution =
  | { ok: true; glob: string; matched: string[] }
  | { ok: false; result: EvalCheckResult }

/**
 * A lazily-memoized repo file list for one `evaluate()` (#1522). The first glob check walks the
 * tree; every subsequent glob check reuses the same list — K glob checks ⇒ ONE tree-walk. A
 * registry with no glob check never invokes it, so K=0 ⇒ 0 walks (no eager regression).
 */
type FileWalk = () => string[]

/**
 * Immutable per-`evaluate()` run context threaded to each check: the repo root, the resolved
 * options, and the memoized tree-walk (#1522). Bundled into one object so the check dispatchers
 * stay within the parameter ceiling instead of passing root/options/getFiles around individually.
 */
interface EvalRun {
  root: string
  options: EvaluateOptions
  getFiles: FileWalk
}

/**
 * Resolve a glob-check's `args.glob` to a SORTED match list — the invalid-glob guard lives here
 * once, shared by every glob-based check (mirrored in scripts/lib/gold-audit-lib.mjs). `getFiles`
 * threads the per-evaluate memoized walk (#1522) so glob checks share one tree-walk.
 */
function resolveGlobArg(
  args: Record<string, unknown>,
  root: string,
  getFiles: FileWalk,
): GlobResolution {
  const glob = typeof args['glob'] === 'string' ? args['glob'] : ''
  const matched = glob === '' ? null : expandGlob(root, glob, getFiles())
  if (matched === null) {
    return {
      ok: false,
      result: { verdict: 'N', evidence: { file: glob, detail: 'invalid or empty glob' } },
    }
  }
  return { ok: true, glob, matched }
}

/** True if a string contains any glob metacharacter (so it is NOT a literal path). */
function hasGlobChar(s: string): boolean {
  return /[*?[\]]/.test(s)
}

/** Validate exclude_paths: each entry literal (no glob char) + a rationale present. N result or null. */
function forbiddenExcludeViolation(
  excludeRaw: unknown[],
  glob: string,
  args: Record<string, unknown>,
): EvalCheckResult | null {
  for (const ex of excludeRaw) {
    if (typeof ex !== 'string' || hasGlobChar(ex)) {
      return {
        verdict: 'N',
        evidence: { file: glob, detail: `exclude_paths must be literal: ${String(ex)}` },
      }
    }
  }
  if (excludeRaw.length > 0) {
    const rationale = typeof args['rationale'] === 'string' ? args['rationale'].trim() : ''
    if (rationale === '') {
      return {
        verdict: 'N',
        evidence: { file: glob, detail: 'exclude_paths requires a rationale' },
      }
    }
  }
  return null
}

/** Scan each remaining (sorted) file for `re`; first anomaly wins. Unreadable ⇒ N (no fake-green). */
function scanForbiddenFiles(
  remaining: string[],
  re: RegExp,
  root: string,
  glob: string,
): EvalCheckResult {
  for (const rel of remaining) {
    const abs = safeResolve(root, rel)
    // Capped read (#1525): an over-cap matched file fails closed — we cannot assert ABSENCE over
    // bytes we refuse to read, so it is N (never a fake-green Y), with the cap noted in the evidence.
    const read = abs === null ? null : readScanText(abs)
    if (read === null || !read.ok) {
      // A matched, non-excluded file we cannot read (or that exceeds the scan cap) ⇒ we cannot assert
      // the pattern is ABSENT over it. Fail-closed N (never a silent skip → a chmod-000 file holding
      // the marker must not fake-green to Y). Deterministic: `remaining` is sorted, first anomaly wins.
      const detail =
        read !== null && read.reason === 'oversize'
          ? `too large to scan (> ${MAX_SCAN_BYTES} bytes) — cannot verify absence`
          : 'unreadable — cannot verify absence'
      return { verdict: 'N', evidence: { file: rel, detail } }
    }
    const text = read.text
    const m = re.exec(text)
    if (m !== null) {
      return {
        verdict: 'N',
        evidence: {
          file: rel,
          line: lineAtIndex(text, m.index),
          detail: 'forbidden pattern present',
        },
      }
    }
  }
  // Y only when EVERY remaining file was actually read — the count is honest, never inflated.
  return {
    verdict: 'Y',
    evidence: { file: glob, detail: `absent across ${remaining.length} file(s)` },
  }
}

function evalForbiddenPattern(
  args: Record<string, unknown>,
  root: string,
  getFiles: FileWalk,
): EvalCheckResult {
  const pattern = typeof args['pattern'] === 'string' ? args['pattern'] : ''
  if (pattern === '') {
    return { verdict: 'N', evidence: { file: '', detail: 'empty or non-string pattern' } }
  }
  let re: RegExp
  try {
    re = new RegExp(pattern)
  } catch {
    return { verdict: 'N', evidence: { file: '', detail: `invalid regex: ${pattern}` } }
  }
  // Reject catastrophic-backtracking patterns (#1525): a valid-syntax ReDoS regex like (a+)+$ would
  // otherwise hang scanForbiddenFiles over an adversarial matched file. Deterministic ⇒ engine-parity.
  if (hasNestedUnboundedQuantifier(pattern)) {
    return { verdict: 'N', evidence: { file: '', detail: `unsafe regex (ReDoS risk): ${pattern}` } }
  }
  const g = resolveGlobArg(args, root, getFiles)
  if (!g.ok) return g.result
  const { glob, matched } = g
  const excludeRaw = Array.isArray(args['exclude_paths'])
    ? (args['exclude_paths'] as unknown[])
    : []
  const violation = forbiddenExcludeViolation(excludeRaw, glob, args)
  if (violation !== null) return violation
  if (matched.length === 0) {
    return { verdict: 'NA', evidence: null }
  }
  const exclude = new Set(excludeRaw as string[])
  const remaining = matched.filter((f) => !exclude.has(f))
  if (remaining.length === 0) {
    return {
      verdict: 'N',
      evidence: { file: glob, detail: 'all matched files excluded (refusing fake-green)' },
    }
  }
  return scanForbiddenFiles(remaining, re, root, glob)
}

// ── file_stat: the executable bit on a glob of files (#1470) ─────────────────────
// Mirror of scripts/lib/gold-audit-lib.mjs. Only the executable bit (mode & 0o111) is portable;
// read/write depend on umask (non-deterministic) ⇒ N. Gated behind core.fileMode (NA when git does
// not track the exec bit). Symlinks evaluated by their own mode (lstat). all exec ⇒ Y, some ⇒ P,
// none ⇒ N; valid glob matching 0 files ⇒ NA; malformed glob ⇒ N.

/**
 * Whether git tracks the executable bit in this repo (core.fileMode). Reads `<root>/.git/config`
 * deterministically (no spawn — INV-12); only an explicit `filemode = false` disables it. A missing
 * or unreadable config ⇒ treated as enabled. Byte-identical to gold-audit-lib.mjs.
 */
function gitFileModeEnabled(root: string): boolean {
  const cfg = readText(resolve(root, '.git/config'))
  if (cfg === null) return true
  let inCore = false
  let lastValue: string | null = null
  for (const raw of cfg.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      // Only the exact top-level [core] section — a `[core "subsection"]` is NOT [core].filemode.
      inCore = /^\[core\]/i.test(line)
      continue
    }
    if (!inCore) continue
    // git honors the LAST value when a key is declared more than once — keep scanning, don't return.
    const m = /^filemode\s*=\s*(\S+)/i.exec(line)
    if (m !== null) lastValue = (m[1] ?? '').toLowerCase()
  }
  return lastValue === null ? true : lastValue !== 'false'
}

/**
 * Whether `abs` is a tracked executable REGULAR file (mode & 0o111, and NOT a symlink). A symlink's
 * own lstat mode is always 0o777 — trusting it would fake-green the exec bit — so a symlink is never
 * executable here: deterministic (symlink-ness is stable) and anti-fake-green.
 */
function isExecutableRegular(abs: string | null): boolean {
  if (abs === null) return false
  try {
    const st = lstatSync(abs)
    return !st.isSymbolicLink() && (st.mode & 0o111) !== 0
  } catch {
    return false
  }
}

function evalFileStat(
  args: Record<string, unknown>,
  root: string,
  getFiles: FileWalk,
): EvalCheckResult {
  const bit = typeof args['bit'] === 'string' ? args['bit'].toLowerCase() : 'executable'
  if (bit !== 'executable') {
    return {
      verdict: 'N',
      evidence: { file: '', detail: `only the executable bit is deterministic, got: ${bit}` },
    }
  }
  const g = resolveGlobArg(args, root, getFiles)
  if (!g.ok) return g.result
  const { glob, matched } = g
  if (matched.length === 0) {
    return { verdict: 'NA', evidence: null }
  }
  if (!gitFileModeEnabled(root)) {
    return { verdict: 'NA', evidence: null }
  }
  let withBit = 0
  let firstMissing: string | null = null
  for (const rel of matched) {
    if (isExecutableRegular(safeResolve(root, rel))) withBit++
    else if (firstMissing === null) firstMissing = rel
  }
  if (withBit === matched.length) {
    return {
      verdict: 'Y',
      evidence: { file: glob, detail: `executable across ${matched.length} file(s)` },
    }
  }
  if (withBit === 0) {
    return { verdict: 'N', evidence: { file: firstMissing ?? glob, detail: 'not executable' } }
  }
  return {
    verdict: 'P',
    evidence: { file: firstMissing ?? glob, detail: `executable ${withBit}/${matched.length}` },
  }
}

/**
 * Evaluate a single check against the repo.
 * Returns { verdict, evidence } — evidence is null for NA/NV.
 * Glob/pair checks (version_consistency, forbidden_pattern, file_stat) dispatch BEFORE the
 * single-file `args.path` resolve, since they own their own path handling.
 */
function evalCheck(check: CheckInput, run: EvalRun): EvalCheckResult {
  const type = check.type
  if (type === 'manual') return { verdict: 'NV', evidence: null }

  const { root } = run
  const args = check.args ?? {}
  if (type === 'version_consistency') return evalVersionConsistency(args, root)
  if (type === 'forbidden_pattern') return evalForbiddenPattern(args, root, run.getFiles)
  if (type === 'file_stat') return evalFileStat(args, root, run.getFiles)
  return evalSingleFileCheck(check, type, args, root, run.options)
}

/** Dispatch the single-file (path-based) check types after resolving + guarding `args.path`. */
function evalSingleFileCheck(
  check: CheckInput,
  type: RawScalar | undefined,
  args: NonNullable<CheckInput['args']>,
  root: string,
  options: EvaluateOptions,
): EvalCheckResult {
  // A non-string path (missing, or a malformed registry's numeric path) is a verified N 'invalid
  // path' — NEVER fed to safeResolve (which would throw on a non-string and fail-close the whole
  // registry). Byte-identical to the .mjs (safeResolve's leading `typeof p !== 'string'` guard).
  const rawPath = args['path']
  if (typeof rawPath !== 'string') {
    return { verdict: 'N', evidence: { file: String(rawPath ?? ''), detail: INVALID_PATH } }
  }
  const abs = safeResolve(root, rawPath)
  if (abs === null) {
    return { verdict: 'N', evidence: { file: rawPath, detail: INVALID_PATH } }
  }
  const rel = rawPath

  if (type === 'file_exists') return evalFileExists(abs, rel)
  // String()-coerce every text arg (a bare numeric YAML scalar like `pattern: 7` types to a number;
  // count_matches' `(7).length` is undefined ⇒ a silent Y→N flip) — byte-identical to the .mjs.
  if (type === 'file_contains') return evalFileContains(abs, rel, String(args['pattern'] ?? ''))
  if (type === 'count_matches')
    return evalCountMatches(abs, rel, String(args['pattern'] ?? ''), Number(args['min'] ?? 1))
  if (type === 'value') {
    // A value check with a report `format` reads a pre-generated tool report (#1413); without one it
    // keeps the legacy single-line `equals`-contains behavior (back-compat — same verdicts as before).
    // Truthy covers both undefined and "" (runtime YAML may carry either) for the legacy fall-through.
    return args['format']
      ? evalValueReport(abs, rel, check, options)
      : evalValue(abs, rel, String(args['equals'] ?? ''))
  }

  // Unknown check type — fail-closed (not NV, not silent pass)
  return { verdict: 'N', evidence: { file: rel, detail: `unknown check type: ${type}` } }
}

// ── applies_if conditional gating (G1) ──────────────────────────────────────────
// Mirror of scripts/lib/gold-audit-lib.mjs (parity contract). A precondition that is MET ⇒ the
// check is evaluated; UNMET ⇒ NA. FAIL-SAFE: a malformed / uninterpretable precondition (unknown
// type, missing required field, invalid path) ⇒ the check APPLIES — a silent skip is a false-green.

/** capability precondition: met when `name` is in the overlay set. Missing name ⇒ APPLIES. */
function capabilityMet(cond: PreconditionInput, overlays: Set<string>): boolean {
  const name = typeof cond.name === 'string' ? cond.name : ''
  if (name === '') return true
  return overlays.has(name)
}

/** file_exists precondition: met when `path` resolves to an existing file. Bad path ⇒ APPLIES. */
function fileExistsMet(cond: PreconditionInput, root: string): boolean {
  const p = typeof cond.path === 'string' ? cond.path : ''
  if (p === '') return true
  const abs = safeResolve(root, p)
  if (abs === null) return true
  return existsSync(abs)
}

/** file_contains precondition: met when the file at `path` contains `pattern`. Malformed ⇒ APPLIES. */
function fileContainsMet(cond: PreconditionInput, root: string): boolean {
  const p = typeof cond.path === 'string' ? cond.path : ''
  const pattern = typeof cond.pattern === 'string' ? cond.pattern : ''
  if (p === '' || pattern === '') return true
  const abs = safeResolve(root, p)
  if (abs === null) return true
  const text = readText(abs)
  if (text === null) return false // marker file absent/unreadable ⇒ precondition UNMET ⇒ NA
  return text.includes(pattern)
}

/** count_matches precondition: met when `path` contains `pattern` ≥ `min` times. Malformed ⇒ APPLIES. */
function countMatchesMet(cond: PreconditionInput, root: string): boolean {
  const p = typeof cond.path === 'string' ? cond.path : ''
  const pattern = typeof cond.pattern === 'string' ? cond.pattern : ''
  if (p === '' || pattern === '') return true
  const min = Number(cond.min ?? 1)
  if (!Number.isFinite(min)) return true
  const abs = safeResolve(root, p)
  if (abs === null) return true
  const text = readText(abs)
  if (text === null) return false // marker file absent/unreadable ⇒ precondition UNMET ⇒ NA
  return countOccurrences(text, pattern) >= min
}

/** Dispatch an object-form precondition. Unknown `type` ⇒ APPLIES (fail-safe, never a silent skip). */
function preconditionApplies(
  cond: PreconditionInput,
  overlays: Set<string>,
  root: string,
): boolean {
  const type = typeof cond.type === 'string' ? cond.type : ''
  if (type === 'capability') return capabilityMet(cond, overlays)
  if (type === 'file_exists') return fileExistsMet(cond, root)
  if (type === 'file_contains') return fileContainsMet(cond, root)
  if (type === 'count_matches') return countMatchesMet(cond, root)
  return true
}

/**
 * True if a check applies (absent applies_if ⇒ always). A string is an overlay/capability name
 * (legacy). An object is a generic precondition (G1). Any other type ⇒ APPLIES (fail-safe).
 */
function isApplicable(check: CheckInput, overlays: Set<string>, root: string): boolean {
  const cond = check.applies_if
  if (!cond || cond === 'always') return true
  if (typeof cond === 'string') return overlays.has(cond)
  if (typeof cond === 'object') return preconditionApplies(cond, overlays, root)
  return true
}

// ── Accumulator helpers ───────────────────────────────────────────────────────

interface DimAccum {
  earned: number
  possible: number
  y: number
}

function accumDim(
  dims: Map<string, DimAccum>,
  dimId: string,
  verdict: Verdict,
  weight: number,
): void {
  let d = dims.get(dimId)
  if (d === undefined) {
    d = { earned: 0, possible: 0, y: 0 }
    dims.set(dimId, d)
  }
  if (verdict === 'Y') d.y++
  if (verdict !== 'NA' && verdict !== 'NV') {
    d.earned += verdictPoints(verdict) * weight
    d.possible += weight
  }
}

function buildDimensions(
  dims: Map<string, DimAccum>,
): Record<string, { score: number; y: number }> {
  const result: Record<string, { score: number; y: number }> = {}
  for (const [id, d] of [...dims.entries()].sort((a, b) => cmpCodeUnit(a[0], b[0]))) {
    result[id] = {
      score: d.possible > 0 ? Math.round((d.earned / d.possible) * 1000) / 10 : 0,
      y: d.y,
    }
  }
  return result
}

function processCheck(
  check: CheckInput,
  overlays: Set<string>,
  dims: Map<string, DimAccum>,
  run: EvalRun,
): {
  checkResult: CheckResult
  yCount: number
  riskyCount: number
  earned: number
  possible: number
} {
  const applicable = isApplicable(check, overlays, run.root)
  let verdict: Verdict
  let evidence: Evidence | null

  if (!applicable) {
    verdict = 'NA'
    evidence = null
  } else {
    const r = evalCheck(check, run)
    verdict = r.verdict
    evidence = r.evidence
  }

  // Coerce weight numerically (a YAML-quoted `weight: '2'` must SUM, not string-concatenate, the
  // accumulator) — byte-identical to the .mjs. A non-numeric/non-finite/negative weight (a registry
  // typo like `weight: high`) would otherwise yield NaN, and a single NaN poisons the summed
  // earned/possible accumulators for the WHOLE registry → a silent overall score of 0. Coerce any
  // such weight to the default 1 so one bad cell can never zero every sibling's score.
  const rawWeight = Number(check.weight ?? 1)
  const weight = Number.isFinite(rawWeight) && rawWeight >= 0 ? rawWeight : 1
  const risk = check.risk === 'RISKY' ? 'RISKY' : 'SAFE'
  // String()-coerce every emitted metadata field (an unquoted YAML scalar like `dimension: 7` types
  // to a number) so the scored payload is byte-identical to the .mjs across loosely-typed registries.
  const dimId = String(check.dimension ?? 'D-UNCLASSIFIED')

  accumDim(dims, dimId, verdict, weight)

  let earned = 0
  let possible = 0
  if (verdict !== 'NA' && verdict !== 'NV') {
    earned = verdictPoints(verdict) * weight
    possible = weight
  }

  return {
    checkResult: {
      id: String(check.id),
      dimension: dimId,
      title: String(check.title ?? ''),
      type: String(check.type ?? ''),
      verdict,
      weight,
      risk,
      anchor: check.anchor ? String(check.anchor) : null,
      evidence,
    },
    yCount: verdict === 'Y' ? 1 : 0,
    riskyCount: risk === 'RISKY' ? 1 : 0,
    earned,
    possible,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Evaluate the whole registry against `root`. Deterministic: checks sorted by id, no timestamps.
 * Fail-closed: any uncaught error returns a zero-score payload rather than throwing.
 */
export function evaluate(
  registry: RegistryInput,
  overlays: Set<string> | readonly string[] | null | undefined,
  root: string,
  options: EvaluateOptions | null | undefined = {},
): EngineResult {
  try {
    // Normalize the loose arguments the .mjs reference also hardens: a non-Set `overlays` (array) or
    // a `null` options must NOT throw (`overlays.has`/`options.thresholds` on the wrong type) and
    // fail-close the WHOLE registry — both engines normalize at the top instead.
    const overlaySet = overlays instanceof Set ? overlays : new Set(overlays ?? [])
    const opts = options && typeof options === 'object' ? options : {}
    // Drop non-object entries (a stray `-`/commented item in a templated YAML list parses to null)
    // so the valid checks are still scored and neither engine throws — shared shape with the .mjs.
    const rawChecks = (Array.isArray(registry.checks) ? registry.checks : []).filter(
      (c): c is CheckInput => Boolean(c) && typeof c === 'object',
    )
    // Coerce ids to strings before comparing (a malformed registry's numeric id must not throw
    // and fail-close the whole payload) — matches the .mjs `cmpCodeUnit(String(a.id), ...)`.
    const sorted = [...rawChecks].sort((a, b) => cmpCodeUnit(String(a.id), String(b.id)))

    const checks: CheckResult[] = []
    const dims = new Map<string, DimAccum>()
    let yCount = 0
    let riskyCount = 0
    let earned = 0
    let possible = 0

    // Walk the repo tree at most ONCE for the whole evaluate() (#1522): the first glob check
    // (forbidden_pattern / file_stat) triggers the walk and every later glob check reuses the
    // cached list. A registry with no glob check never walks. Per-evaluate state only — no global
    // cache — so determinism + the fail-closed contract are untouched.
    let walkedFiles: string[] | null = null
    const run: EvalRun = {
      root,
      options: opts,
      getFiles: () => (walkedFiles ??= walkRepo(root)),
    }

    for (const check of sorted) {
      const r = processCheck(check, overlaySet, dims, run)
      checks.push(r.checkResult)
      yCount += r.yCount
      riskyCount += r.riskyCount
      earned += r.earned
      possible += r.possible
    }

    const score = possible > 0 ? Math.round((earned / possible) * 1000) / 10 : 0

    return {
      registryVersion: String(registry.version ?? '0'),
      score,
      yCount,
      riskyCount,
      totals: {
        checks: checks.length,
        y: yCount,
        p: checks.filter((c) => c.verdict === 'P').length,
        n: checks.filter((c) => c.verdict === 'N').length,
        na: checks.filter((c) => c.verdict === 'NA').length,
        nv: checks.filter((c) => c.verdict === 'NV').length,
      },
      dimensions: buildDimensions(dims),
      checks,
    }
  } catch {
    return {
      registryVersion: '0',
      score: 0,
      yCount: 0,
      riskyCount: 0,
      totals: { checks: 0, y: 0, p: 0, n: 0, na: 0, nv: 0 },
      dimensions: {},
      checks: [],
    }
  }
}

/** Compare current vs baseline; return { ok, reasons } — ok=false on score/Y regression. */
export function checkNoRegress(
  current: EngineResult,
  baseline: { score: number; yCount: number },
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (current.score < baseline.score) {
    reasons.push(`score regressed: ${current.score} < baseline ${baseline.score}`)
  }
  if (current.yCount < baseline.yCount) {
    reasons.push(`Y-count regressed: ${current.yCount} < baseline ${baseline.yCount}`)
  }
  return { ok: reasons.length === 0, reasons }
}

/** Monotonic ratchet: per field, keep max(current, baseline) — score can only increase. */
export function ratchet(current: EngineResult, baseline: Baseline): Baseline {
  const dimensions: Record<string, { score: number; y: number }> = {}
  const ids = new Set([...Object.keys(current.dimensions), ...Object.keys(baseline.dimensions)])
  for (const id of [...ids].sort(cmpCodeUnit)) {
    const c = current.dimensions[id] ?? { score: 0, y: 0 }
    const p = baseline.dimensions[id] ?? { score: 0, y: 0 }
    dimensions[id] = {
      score: Math.max(c.score, p.score),
      y: Math.max(c.y, p.y),
    }
  }
  return {
    score: Math.max(current.score, baseline.score),
    yCount: Math.max(current.yCount, baseline.yCount),
    dimensions,
  }
}

/** Baseline-shaped snapshot of a scored payload (the ratchet-compared subset, no timestamp). */
export function baselineOf(current: EngineResult): Baseline {
  return { score: current.score, yCount: current.yCount, dimensions: current.dimensions }
}
