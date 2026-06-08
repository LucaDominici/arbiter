// SPDX-License-Identifier: Apache-2.0
//
// #1267 — deterministic agent-dispatch matrix resolver.
//
// The matrix (.claude/agent-dispatch-matrix.json) is a DECLARED oracle mapping
// (tier x track x review_mode x pr_type) -> required agents/verticals, stored COMPRESSED
// as a per-tier base (`tier_verticals`) + additive `track_modifiers` + additive
// `pr_type_modifiers`. This module is the pure resolver that EXPANDS a dispatch key into
// the concrete required set by UNION — additive only, never narrowing below the tier floor
// (fail-safe toward MORE review, mirroring #1260's widest-on-signal-loss rule).
//
// Why a declared oracle (not a re-derivation of the selection code): the verify gate
// (scripts/check-agent-dispatch.mjs) replays the ACTUAL derivation and asserts it equals
// the declared table. If this module simply re-ran the selection logic, the gate would
// compare derivation==derivation (circular) and verify nothing. Independence is the value
// — it eliminates the last self-judgement in review dispatch.
//
// This module is pure I/O-at-the-edge: `loadDispatchMatrix` reads+validates the JSON; the
// resolvers are pure functions over the loaded object. The matrix JSON is ALSO the SSOT for
// the tier->vertical floor: scripts/route-auditors.mjs reads `tier_verticals` here (replacing
// its old inlined SIZE_FLOOR_VERTICALS duplicate) and src/sizing/sizing.ts::sizeVerticals is
// asserted equal to it by the gate.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type DispatchTier = 'XS' | 'S' | 'Standard'
export type DispatchReviewMode = 'plan' | 'code'

/** A fully-specified lookup key into the dispatch oracle. */
export interface DispatchKey {
  tier: DispatchTier
  /** Descriptive track family (auditor-routing glob family). */
  track: string
  review_mode: DispatchReviewMode
  /** Conventional-commit type. */
  pr_type: string
}

/** The parsed + structurally-validated matrix oracle. */
export interface DispatchMatrix {
  axes: {
    tier: string[]
    track: string[]
    review_mode: string[]
    pr_type: string[]
  }
  tier_verticals: Record<string, string[]>
  review_pass_count: Record<string, Record<string, number>>
  track_modifiers: Record<string, string[]>
  pr_type_modifiers: Record<string, string[]>
}

/** The resolved required dispatch set for a key. */
export interface ResolvedDispatch {
  /** Required agent/vertical names (union of tier floor + track + pr_type modifiers). */
  agents: string[]
  /** Number of review passes/agents for this (review_mode, tier). */
  passCount: number
}

const REQUIRED_KEYS = [
  'axes',
  'tier_verticals',
  'review_pass_count',
  'track_modifiers',
  'pr_type_modifiers',
] as const

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

function asRecord(v: unknown, ctx: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`agent-dispatch-matrix: "${ctx}" must be an object`)
  }
  return v as Record<string, unknown>
}

/** Parse the matrix JSON (fail-loud on read/parse error), returning the root object. */
function readMatrixJson(path: string): Record<string, unknown> {
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`agent-dispatch-matrix: cannot read ${path}: ${msg}`, { cause: err })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`agent-dispatch-matrix: invalid JSON in ${path}: ${msg}`, { cause: err })
  }
  const obj = asRecord(parsed, 'root')
  for (const key of REQUIRED_KEYS) {
    if (!(key in obj)) {
      throw new Error(`agent-dispatch-matrix: missing required key "${key}"`)
    }
  }
  return obj
}

/** Validate + extract the four axis string-arrays. */
function parseAxes(obj: Record<string, unknown>): DispatchMatrix['axes'] {
  const axesObj = asRecord(obj['axes'], 'axes')
  for (const a of ['tier', 'track', 'review_mode', 'pr_type'] as const) {
    if (!isStringArray(axesObj[a])) {
      throw new Error(`agent-dispatch-matrix: axes.${a} must be a string[]`)
    }
  }
  return {
    tier: axesObj['tier'] as string[],
    track: axesObj['track'] as string[],
    review_mode: axesObj['review_mode'] as string[],
    pr_type: axesObj['pr_type'] as string[],
  }
}

/** Validate + extract the nested review_pass_count[mode][tier] = non-negative integer map. */
function parseReviewPassCount(
  obj: Record<string, unknown>,
): Record<string, Record<string, number>> {
  const rpcObj = asRecord(obj['review_pass_count'], 'review_pass_count')
  const out: Record<string, Record<string, number>> = {}
  for (const [mode, perTier] of Object.entries(rpcObj)) {
    const inner = asRecord(perTier, `review_pass_count.${mode}`)
    const counts: Record<string, number> = {}
    for (const [tier, n] of Object.entries(inner)) {
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
        throw new Error(
          `agent-dispatch-matrix: review_pass_count.${mode}.${tier} must be a non-negative integer`,
        )
      }
      counts[tier] = n
    }
    out[mode] = counts
  }
  return out
}

/**
 * Read + structurally validate `.claude/agent-dispatch-matrix.json` under `root`.
 * Fails LOUD (throws) on absence, malformed JSON, or a missing/ill-typed key — the
 * matrix is a governance oracle; a silent default would defeat the gate.
 */
export function loadDispatchMatrix(root: string): DispatchMatrix {
  const path = join(root, '.claude', 'agent-dispatch-matrix.json')
  const obj = readMatrixJson(path)
  return {
    axes: parseAxes(obj),
    tier_verticals: coerceStringArrayMap(obj['tier_verticals'], 'tier_verticals'),
    review_pass_count: parseReviewPassCount(obj),
    track_modifiers: coerceStringArrayMap(obj['track_modifiers'], 'track_modifiers'),
    pr_type_modifiers: coerceStringArrayMap(obj['pr_type_modifiers'], 'pr_type_modifiers'),
  }
}

function coerceStringArrayMap(v: unknown, ctx: string): Record<string, string[]> {
  const obj = asRecord(v, ctx)
  const out: Record<string, string[]> = {}
  for (const [k, val] of Object.entries(obj)) {
    if (!isStringArray(val)) {
      throw new Error(`agent-dispatch-matrix: ${ctx}.${k} must be a string[]`)
    }
    out[k] = val
  }
  return out
}

/** The tier-floor vertical projection — the SSOT for `route-auditors --size-floor`. */
export function matrixVerticalsForTier(matrix: DispatchMatrix, tier: string): string[] {
  const v = matrix.tier_verticals[tier]
  if (v === undefined) {
    throw new Error(
      `agent-dispatch-matrix: no tier_verticals for tier "${tier}" (valid: ${Object.keys(
        matrix.tier_verticals,
      ).join(', ')})`,
    )
  }
  return [...v]
}

/**
 * Resolve a dispatch key into its required agent set + pass count. UNION-only: the result
 * is `tier floor ∪ track modifier ∪ pr_type modifier`, in stable first-seen order. Unknown
 * axis values throw (fail-loud, no silent drop). Modifiers can only ADD; they can never
 * remove a tier-floor vertical (verified by the union construction).
 */
export function resolveRequiredAgents(matrix: DispatchMatrix, key: DispatchKey): ResolvedDispatch {
  assertAxis(matrix.axes.tier, key.tier, 'tier')
  assertAxis(matrix.axes.track, key.track, 'track')
  assertAxis(matrix.axes.review_mode, key.review_mode, 'review_mode')
  assertAxis(matrix.axes.pr_type, key.pr_type, 'pr_type')

  const floor = matrixVerticalsForTier(matrix, key.tier)
  const trackMod = matrix.track_modifiers[key.track] ?? []
  const prMod = matrix.pr_type_modifiers[key.pr_type] ?? []

  const agents: string[] = []
  const seen = new Set<string>()
  for (const v of [...floor, ...trackMod, ...prMod]) {
    if (!seen.has(v)) {
      seen.add(v)
      agents.push(v)
    }
  }

  const perMode = matrix.review_pass_count[key.review_mode]
  const passCount = perMode?.[key.tier] ?? 0

  return { agents, passCount }
}

function assertAxis(allowed: string[], value: string, axisName: string): void {
  if (!allowed.includes(value)) {
    throw new Error(
      `agent-dispatch-matrix: unknown ${axisName} "${value}" (valid: ${allowed.join(', ')})`,
    )
  }
}
