// SPDX-License-Identifier: Apache-2.0
// conformance/engine.ts — typed TS port of scripts/lib/gold-audit-lib.mjs (#1393).
//
// Determinism contract: identical repo + identical registry ⇒ identical evaluate() output.
// Checks are evaluated in stable id order; no wall-clock value enters the scored payload.
// Parity gate: engine-parity.test.ts asserts deep-equal verdicts/score/yCount vs the .mjs.

import { existsSync, statSync } from 'node:fs'
import { safeResolve, readText } from './shared.js'

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

export interface CheckInput {
  id: string
  type: string
  args?: {
    path?: string
    pattern?: string
    min?: number
    equals?: string
    /** value-op report extraction format (#1413). */
    format?: 'json' | 'xml' | 'regex'
    /** value-op selector: json dotted-path | xml `count:tag` / `attr:tag@attr` | regex w/ group 1. */
    select?: string
    /** value-op comparison operator (#1413). */
    op?: 'gte' | 'lte' | 'eq'
    /** value-op literal bar (used only when no `threshold_ref` is given). */
    expected?: number
    [key: string]: unknown
  }
  weight?: number
  applies_if?: string
  dimension?: string
  title?: string
  risk?: string
  anchor?: string
  /** Resolve the comparison bar per brownfield class from the thresholds SSOT (#1413). */
  threshold_ref?: string
}

export interface RegistryInput {
  version?: string
  checks?: CheckInput[]
}

/** Per-class numeric bar for one threshold_ref key (the thresholds.yml row). */
export type ThresholdRow = Record<string, number>
/** The brownfield-class threshold SSOT: threshold_ref → { gold, light, medium, heavy }. */
export type ThresholdTable = Record<string, ThresholdRow>

/** Optional evaluation context: thresholds SSOT + the active brownfield class (#1413). */
export interface EvaluateOptions {
  thresholds?: ThresholdTable
  brownfieldClass?: string
}

export interface CheckResult {
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

type EvalCheckResult = { verdict: Verdict; evidence: Evidence | null }

/** 1-based line number of the first occurrence of `needle` in `text`, or null. */
function lineOf(text: string, needle: string): number | null {
  const idx = text.indexOf(needle)
  if (idx < 0) return null
  let line = 1
  for (let i = 0; i < idx; i++) if (text[i] === '\n') line++
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
  if (!existsSync(abs)) return { verdict: 'N', evidence: null }
  try {
    if (statSync(abs).isDirectory()) return { verdict: 'N', evidence: null }
  } catch {
    return { verdict: 'N', evidence: null }
  }
  return { verdict: 'Y', evidence: { file: rel } }
}

function evalFileContains(abs: string, rel: string, pattern: string): EvalCheckResult {
  const text = readText(abs)
  if (text === null) return { verdict: 'N', evidence: { file: rel, detail: 'missing' } }
  const line = lineOf(text, pattern)
  return line !== null
    ? { verdict: 'Y', evidence: { file: rel, line } }
    : { verdict: 'N', evidence: { file: rel, detail: `pattern not found: ${pattern}` } }
}

function evalCountMatches(
  abs: string,
  rel: string,
  pattern: string,
  want: number,
): EvalCheckResult {
  const text = readText(abs)
  if (text === null) return { verdict: 'N', evidence: { file: rel, detail: 'missing' } }
  let count = 0
  let from = 0
  while (pattern.length > 0) {
    const i = text.indexOf(pattern, from)
    if (i < 0) break
    count++
    from = i + pattern.length
  }
  if (count >= want) return { verdict: 'Y', evidence: { file: rel, detail: `count=${count}` } }
  if (count > 0) return { verdict: 'P', evidence: { file: rel, detail: `count=${count}/${want}` } }
  return { verdict: 'N', evidence: { file: rel, detail: `count=0/${want}` } }
}

function evalValue(abs: string, rel: string, expected: string): EvalCheckResult {
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
  for (const key of select.split('.')) {
    if (key === '') continue
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

function extractXml(text: string, select: string): number | null {
  if (select.startsWith('count:')) {
    const tag = select.slice('count:'.length)
    if (tag === '') return null
    let count = 0
    const needle = `<${tag}`
    let from = 0
    for (;;) {
      const i = text.indexOf(needle, from)
      if (i < 0) break
      if (isXmlElementBoundary(text[i + needle.length])) count++
      from = i + needle.length
    }
    return count
  }
  if (select.startsWith('attr:')) {
    const spec = select.slice('attr:'.length)
    const at = spec.indexOf('@')
    if (at < 0) return null
    const tag = spec.slice(0, at)
    const attr = spec.slice(at + 1)
    if (tag === '' || attr === '') return null
    const open = text.indexOf(`<${tag}`)
    if (open < 0) return null
    const close = text.indexOf('>', open)
    const segment = close < 0 ? text.slice(open) : text.slice(open, close)
    const m = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`).exec(segment)
    if (m === null) return null
    const n = Number(m[1])
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Read a numeric metric from text via a regex whose first capture group is the number. */
function extractRegex(text: string, select: string): number | null {
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

/** Extract a numeric metric from a report's text for the given format + selector, or null. */
function extractMetric(text: string, format: string, select: string): number | null {
  if (format === 'json') return extractJson(text, select)
  if (format === 'xml') return extractXml(text, select)
  if (format === 'regex') return extractRegex(text, select)
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
  const format = args.format ?? ''
  const select = args.select ?? ''
  const op = args.op ?? ''
  const bar = resolveBar(check, options)
  if (bar === null) {
    return { verdict: 'N', evidence: { file: rel, detail: 'unresolved threshold' } }
  }
  const text = readText(abs)
  if (text === null) return { verdict: 'N', evidence: { file: rel, detail: 'unreadable' } }
  const actual = extractMetric(text, format, select)
  if (actual === null) {
    return { verdict: 'N', evidence: { file: rel, detail: `no metric for ${format}:${select}` } }
  }
  const pass = compareValue(actual, op, bar)
  return pass
    ? { verdict: 'Y', evidence: { file: rel, detail: `${actual} ${op} ${bar}` } }
    : { verdict: 'N', evidence: { file: rel, detail: `${actual} !${op} ${bar}` } }
}

/**
 * Evaluate a single check against the repo.
 * Returns { verdict, evidence } — evidence is null for NA/NV.
 */
function evalCheck(check: CheckInput, root: string, options: EvaluateOptions): EvalCheckResult {
  const { type } = check
  if (type === 'manual') return { verdict: 'NV', evidence: null }

  const args = check.args ?? {}
  const rawPath = args['path'] ?? ''
  const abs = safeResolve(root, rawPath)
  if (abs === null) {
    return { verdict: 'N', evidence: { file: rawPath, detail: 'invalid path' } }
  }
  const rel = rawPath

  if (type === 'file_exists') return evalFileExists(abs, rel)
  if (type === 'file_contains') return evalFileContains(abs, rel, args['pattern'] ?? '')
  if (type === 'count_matches')
    return evalCountMatches(abs, rel, args['pattern'] ?? '', args['min'] ?? 1)
  if (type === 'value') {
    // A value check with a report `format` reads a pre-generated tool report (#1413); without one it
    // keeps the legacy single-line `equals`-contains behavior (back-compat — same verdicts as before).
    // Truthy covers both undefined and "" (runtime YAML may carry either) for the legacy fall-through.
    return args['format']
      ? evalValueReport(abs, rel, check, options)
      : evalValue(abs, rel, args['equals'] ?? '')
  }

  // Unknown check type — fail-closed (not NV, not silent pass)
  return { verdict: 'N', evidence: { file: rel, detail: `unknown check type: ${type}` } }
}

/** True if a check's overlay condition is satisfied (absent ⇒ always applies). */
function isApplicable(check: CheckInput, overlays: Set<string>): boolean {
  const cond = check.applies_if
  if (!cond || cond === 'always') return true
  return overlays.has(cond)
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
  for (const [id, d] of [...dims.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], 'en', { sensitivity: 'variant' }),
  )) {
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
  root: string,
  dims: Map<string, DimAccum>,
  options: EvaluateOptions,
): {
  checkResult: CheckResult
  yCount: number
  riskyCount: number
  earned: number
  possible: number
} {
  const applicable = isApplicable(check, overlays)
  let verdict: Verdict
  let evidence: Evidence | null

  if (!applicable) {
    verdict = 'NA'
    evidence = null
  } else {
    const r = evalCheck(check, root, options)
    verdict = r.verdict
    evidence = r.evidence
  }

  const weight = check.weight ?? 1
  const risk = check.risk === 'RISKY' ? 'RISKY' : 'SAFE'
  const dimId = check.dimension ?? 'D-UNCLASSIFIED'

  accumDim(dims, dimId, verdict, weight)

  let earned = 0
  let possible = 0
  if (verdict !== 'NA' && verdict !== 'NV') {
    earned = verdictPoints(verdict) * weight
    possible = weight
  }

  return {
    checkResult: {
      id: check.id,
      dimension: dimId,
      title: check.title ?? '',
      type: check.type,
      verdict,
      weight,
      risk,
      anchor: check.anchor ?? null,
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
  overlays: Set<string>,
  root: string,
  options: EvaluateOptions = {},
): EngineResult {
  try {
    const rawChecks = Array.isArray(registry.checks) ? registry.checks : []
    const sorted = [...rawChecks].sort((a, b) =>
      a.id.localeCompare(b.id, 'en', { sensitivity: 'variant' }),
    )

    const checks: CheckResult[] = []
    const dims = new Map<string, DimAccum>()
    let yCount = 0
    let riskyCount = 0
    let earned = 0
    let possible = 0

    for (const check of sorted) {
      const r = processCheck(check, overlays, root, dims, options)
      checks.push(r.checkResult)
      yCount += r.yCount
      riskyCount += r.riskyCount
      earned += r.earned
      possible += r.possible
    }

    const score = possible > 0 ? Math.round((earned / possible) * 1000) / 10 : 0

    return {
      registryVersion: registry.version ?? '0',
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
  for (const id of [...ids].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'variant' }))) {
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
