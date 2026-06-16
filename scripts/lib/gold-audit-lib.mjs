// SPDX-License-Identifier: Apache-2.0
// gold-audit-lib.mjs — deterministic gold-audit evaluator (#1373).
//
// Reimplements the upstream reference gold-audit registry evaluator natively in node (zero
// Python dependency). The score is computed by code, never by an AI. Pure functions only — no
// process.exit, no argv, no console. The thin CLI (scripts/gold-audit.mjs) and the report
// consumer (scripts/gold-report.mjs) both call evaluate() so there is one code path.
//
// Verdicts (per check):
//   Y  — verified true by code, with evidence (file [+ line])
//   P  — partial (a count_matches check met some but not all of its target)
//   N  — verified false by code, with evidence (the path/pattern that was absent)
//   NA — not applicable (applies_if overlay disabled)
//   NV — not verified by code (manual / attestation-required check)
//
// Determinism contract: identical repo + identical registry ⇒ identical evaluate() output.
// Checks are evaluated in stable id order; no wall-clock value enters the scored payload.

import { existsSync, readFileSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'

/** Resolve a registry-declared path inside root; reject traversal/absolute escapes. */
function safeResolve(root, p) {
  if (typeof p !== 'string' || p.length === 0) return null
  if (isAbsolute(p) || p.includes('..')) return null
  const abs = resolve(root, p)
  const rel = relative(root, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return abs
}

/** Read a file's text, or null if missing/unreadable. */
function readText(abs) {
  try {
    return readFileSync(abs, 'utf-8')
  } catch {
    return null
  }
}

/** 1-based line number of the first occurrence of `needle` in `text`, or null. */
function lineOf(text, needle) {
  const idx = text.indexOf(needle)
  if (idx < 0) return null
  let line = 1
  for (let i = 0; i < idx; i++) if (text[i] === '\n') line++
  return line
}

/**
 * Evaluate a single check against the repo. Returns { verdict, evidence } where evidence is
 * { file, line? , detail? } for code-verifiable checks, or null for NA/NV.
 */
function evalCheck(check, root) {
  const type = check.type
  if (type === 'manual') {
    return { verdict: 'NV', evidence: null }
  }
  const args = check.args || {}
  const abs = safeResolve(root, args.path)
  if (abs === null) {
    // An unresolvable / traversal path is a verified failure, with a detail note.
    return { verdict: 'N', evidence: { file: String(args.path ?? ''), detail: 'invalid path' } }
  }
  const rel = args.path

  if (type === 'file_exists') {
    return existsSync(abs)
      ? { verdict: 'Y', evidence: { file: rel } }
      : { verdict: 'N', evidence: { file: rel, detail: 'missing' } }
  }

  if (type === 'file_contains') {
    const text = readText(abs)
    if (text === null) return { verdict: 'N', evidence: { file: rel, detail: 'missing' } }
    const pattern = String(args.pattern ?? '')
    const line = lineOf(text, pattern)
    return line !== null
      ? { verdict: 'Y', evidence: { file: rel, line } }
      : { verdict: 'N', evidence: { file: rel, detail: `pattern not found: ${pattern}` } }
  }

  if (type === 'count_matches') {
    const text = readText(abs)
    if (text === null) return { verdict: 'N', evidence: { file: rel, detail: 'missing' } }
    const pattern = String(args.pattern ?? '')
    const want = Number(args.min ?? 1)
    let count = 0
    let from = 0
    while (pattern.length > 0) {
      const i = text.indexOf(pattern, from)
      if (i < 0) break
      count++
      from = i + pattern.length
    }
    if (count >= want) return { verdict: 'Y', evidence: { file: rel, detail: `count=${count}` } }
    if (count > 0)
      return { verdict: 'P', evidence: { file: rel, detail: `count=${count}/${want}` } }
    return { verdict: 'N', evidence: { file: rel, detail: `count=0/${want}` } }
  }

  if (type === 'value') {
    // value: file_contains with an explicit equals on a single captured line.
    const text = readText(abs)
    if (text === null) return { verdict: 'N', evidence: { file: rel, detail: 'missing' } }
    const expect = String(args.equals ?? '')
    const line = lineOf(text, expect)
    return line !== null
      ? { verdict: 'Y', evidence: { file: rel, line } }
      : { verdict: 'N', evidence: { file: rel, detail: `value not present: ${expect}` } }
  }

  // Unknown check type — treat as not verified (never a silent pass).
  return { verdict: 'N', evidence: { file: rel || '', detail: `unknown check type: ${type}` } }
}

/** True if a check's overlay condition is satisfied (applies_if absent ⇒ always applies). */
function isApplicable(check, overlays) {
  const cond = check.applies_if
  if (!cond || cond === 'always') return true
  return overlays.has(cond)
}

/** Numeric verdict weight: Y=1, P=0.5, N=0; NA/NV excluded from the denominator. */
function verdictPoints(verdict) {
  if (verdict === 'Y') return 1
  if (verdict === 'P') return 0.5
  return 0
}

/**
 * Evaluate the whole registry. Deterministic: checks sorted by id, no timestamps.
 * @returns scored payload: { registryVersion, score, yCount, riskyCount, totals, dimensions, checks }
 */
export function evaluate(registry, overlays, root) {
  const overlaySet = overlays instanceof Set ? overlays : new Set(overlays || [])
  const rawChecks = Array.isArray(registry?.checks) ? registry.checks : []
  const sorted = [...rawChecks].sort((a, b) => String(a.id).localeCompare(String(b.id)))

  const checks = []
  const dims = new Map()
  let yCount = 0
  let riskyCount = 0
  let earned = 0
  let possible = 0

  for (const check of sorted) {
    const applicable = isApplicable(check, overlaySet)
    let verdict
    let evidence
    if (!applicable) {
      verdict = 'NA'
      evidence = null
    } else {
      const r = evalCheck(check, root)
      verdict = r.verdict
      evidence = r.evidence
    }

    const weight = Number(check.weight ?? 1)
    const risk = check.risk === 'RISKY' ? 'RISKY' : 'SAFE'
    if (risk === 'RISKY') riskyCount++
    if (verdict === 'Y') yCount++

    // Scoring denominator: applicable, code-verifiable checks only (exclude NA + NV).
    if (verdict !== 'NA' && verdict !== 'NV') {
      earned += verdictPoints(verdict) * weight
      possible += weight
    }

    const dimId = String(check.dimension ?? 'D-UNCLASSIFIED')
    if (!dims.has(dimId)) dims.set(dimId, { earned: 0, possible: 0, y: 0 })
    const d = dims.get(dimId)
    if (verdict === 'Y') d.y++
    if (verdict !== 'NA' && verdict !== 'NV') {
      d.earned += verdictPoints(verdict) * weight
      d.possible += weight
    }

    checks.push({
      id: String(check.id),
      dimension: dimId,
      title: String(check.title ?? ''),
      type: String(check.type ?? ''),
      verdict,
      weight,
      risk,
      anchor: check.anchor ? String(check.anchor) : null,
      evidence,
    })
  }

  const score = possible > 0 ? Math.round((earned / possible) * 1000) / 10 : 0
  const dimensions = {}
  for (const [id, d] of [...dims.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    dimensions[id] = {
      score: d.possible > 0 ? Math.round((d.earned / d.possible) * 1000) / 10 : 0,
      y: d.y,
    }
  }

  return {
    registryVersion: String(registry?.version ?? '0'),
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
    dimensions,
    checks,
  }
}

/** Compare current vs baseline; return { ok, reasons } — ok=false on score/Y regression. */
export function checkNoRegress(current, baseline) {
  const reasons = []
  if (!baseline || typeof baseline !== 'object') return { ok: true, reasons }
  if (typeof baseline.score === 'number' && current.score < baseline.score) {
    reasons.push(`score regressed: ${current.score} < baseline ${baseline.score}`)
  }
  if (typeof baseline.yCount === 'number' && current.yCount < baseline.yCount) {
    reasons.push(`Y-count regressed: ${current.yCount} < baseline ${baseline.yCount}`)
  }
  return { ok: reasons.length === 0, reasons }
}

/** Monotonic ratchet: per field, keep max(current, baseline) — can only tighten. */
export function ratchet(current, baseline) {
  const prev = baseline && typeof baseline === 'object' ? baseline : {}
  const dimensions = {}
  const ids = new Set([
    ...Object.keys(current.dimensions || {}),
    ...Object.keys(prev.dimensions || {}),
  ])
  for (const id of [...ids].sort()) {
    const c = current.dimensions?.[id] || { score: 0, y: 0 }
    const p = prev.dimensions?.[id] || { score: 0, y: 0 }
    dimensions[id] = { score: Math.max(c.score, p.score ?? 0), y: Math.max(c.y, p.y ?? 0) }
  }
  return {
    score: Math.max(current.score, typeof prev.score === 'number' ? prev.score : 0),
    yCount: Math.max(current.yCount, typeof prev.yCount === 'number' ? prev.yCount : 0),
    dimensions,
  }
}

/** Baseline-shaped snapshot of a scored payload (the ratchet-compared subset, no timestamp). */
export function baselineOf(current) {
  return { score: current.score, yCount: current.yCount, dimensions: current.dimensions }
}

// ── #1414: deterministic gold-LEVEL band + "what's missing" gap report ──────────────────────────
//
// The level band maps a code-computed score (0–100) to a Target Maturity Level (L0–L3) keyed by
// the repo's brownfieldClass: a heavy legacy repo reaches a given band at a LOWER score than a
// greenfield gold repo (the realistic target differs by starting condition). Thresholds are the
// minimum score required to ENTER each level; L0 is the floor (always entered).

/** Per-class entry thresholds: [L1, L2, L3] minimum scores. gold = strictest, heavy = most lenient. */
const LEVEL_THRESHOLDS = {
  gold: [50, 75, 95],
  light: [45, 70, 90],
  medium: [40, 60, 85],
  heavy: [30, 50, 75],
}
const LEVELS = ['L0', 'L1', 'L2', 'L3']

/**
 * Map a score to a level band for a brownfieldClass. Pure + deterministic.
 * @returns { level, nextLevel, toNextLevel, brownfieldClass, thresholds }
 */
export function levelBand(score, brownfieldClass) {
  const cls = Object.prototype.hasOwnProperty.call(LEVEL_THRESHOLDS, brownfieldClass)
    ? brownfieldClass
    : 'gold' // unknown class → strictest band (fail-safe, never over-credits)
  const thresholds = LEVEL_THRESHOLDS[cls]
  const s = Number.isFinite(score) ? score : 0
  let idx = 0
  for (let i = 0; i < thresholds.length; i++) if (s >= thresholds[i]) idx = i + 1
  const level = LEVELS[idx]
  const nextLevel = idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null
  const toNextLevel =
    nextLevel === null ? 0 : Math.max(0, Math.round((thresholds[idx] - s) * 10) / 10)
  return { level, nextLevel, toNextLevel, brownfieldClass: cls, thresholds }
}

/**
 * "What's missing" report: the checks with verdict N or P (the actionable gaps), grouped by
 * dimension (family), each with its evidence. Y/NA/NV are excluded — you cannot close an NV (code
 * can't verify it) or an NA (it doesn't apply) by working on it. Deterministic: dimensions sorted
 * by id, checks in the already-stable id order from evaluate().
 * @returns Array<{ dimension, title, checks: Array<{id,title,verdict,evidence,anchor}> }>
 */
export function gapReport(result) {
  const checks = Array.isArray(result?.checks) ? result.checks : []
  const byDim = new Map()
  for (const c of checks) {
    if (c.verdict !== 'N' && c.verdict !== 'P') continue
    const dim = String(c.dimension ?? 'D-UNCLASSIFIED')
    if (!byDim.has(dim)) byDim.set(dim, [])
    byDim.get(dim).push({
      id: c.id,
      title: c.title,
      verdict: c.verdict,
      anchor: c.anchor ?? null,
      evidence: c.evidence ?? null,
    })
  }
  return [...byDim.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dimension, gaps]) => ({ dimension, checks: gaps }))
}
