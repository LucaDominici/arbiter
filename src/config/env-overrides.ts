// SPDX-License-Identifier: Apache-2.0
/**
 * Environment variable override layer for ArbiterConfigV2.
 *
 * Precedence: env > file > defaults. Applied AFTER migrate() so the input
 * is already a structurally-valid v2 config.
 *
 * Patterns:
 *   ARBITER_THRESHOLD__<FIELD>  → thresholds.<camelCaseField>  (numeric)
 *   ARBITER_FEATURE__<FLAG>     → features.<camelCaseFlag>     (boolean)
 *   ARBITER_<TOP_FIELD>         → top-level scalar fields      (per-field rules)
 *
 * Unknown fields, malformed values, and unrelated env vars are silently ignored —
 * env overrides must NEVER turn a valid config into an invalid one.
 *
 * Issue: #233
 */

import type { GovernanceLevel } from '../wizard/types.js'
import { parseBooleanEnv } from '../utils/env.js'
import { DEFAULT_THRESHOLDS, isThresholdValueInRange } from './schema.js'
import type { ArbiterConfigV2, FeatureFlags, ThresholdsV2 } from './schema.js'

type Env = Record<string, string | undefined>

const THRESHOLD_PREFIX = 'ARBITER_THRESHOLD__'
const FEATURE_PREFIX = 'ARBITER_FEATURE__'

const VALID_THRESHOLD_KEYS = new Set<keyof ThresholdsV2>([
  'lineCoverage',
  'branchCoverage',
  'mutationScore',
  'cyclomaticComplexity',
  'methodLength',
  'maxParams',
])

const VALID_FEATURE_KEYS = new Set<keyof FeatureFlags>([
  'contractTesting',
  'mutationTesting',
  'securityScanning',
  'evidenceHarness',
  'debtGates',
  'suppressions',
])

/**
 * Convert SCREAMING_SNAKE_CASE to camelCase.
 * Examples: LINE_COVERAGE → lineCoverage, GOVERNANCE_LEVEL → governanceLevel
 */
function screamingSnakeToCamel(s: string): string {
  return s
    .toLowerCase()
    .split('_')
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
}

function parseNumericEnv(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const n = Number(trimmed)
  if (Number.isNaN(n) || !Number.isFinite(n)) return undefined
  return n
}

/**
 * Observability for dropped overrides (INV-96, #1537).
 *
 * The env layer must NEVER turn a valid config into an invalid one, so an
 * unknown field or unparseable value is still ignored — but a SILENT drop lets
 * an operator believe they tightened a gate when the default is in fact running.
 * Emit a one-line stderr warning so the drop is observable without changing the
 * no-invalidate semantics.
 */
function warnDroppedOverride(envKey: string, reason: string): void {
  process.stderr.write(`[arbiter] env override ${envKey} ignored — ${reason}; default retained\n`)
}

function applyThresholdOverride(
  thresholds: ThresholdsV2,
  envKey: string,
  rawValue: string,
): ThresholdsV2 {
  const camel = screamingSnakeToCamel(envKey.slice(THRESHOLD_PREFIX.length))
  if (!VALID_THRESHOLD_KEYS.has(camel as keyof ThresholdsV2)) {
    warnDroppedOverride(envKey, `unknown threshold field "${camel}"`)
    return thresholds
  }
  const value = parseNumericEnv(rawValue)
  if (value === undefined) {
    warnDroppedOverride(envKey, `value "${rawValue}" is not a finite number`)
    return thresholds
  }
  // #1585: an out-of-range value (coverage keys must be 1..100; positive keys > 0)
  // must be dropped+warned here — applying it would flow into validateConfig and
  // brick every arbiter command in the shell with a misleading "fix arbiter.json"
  // error, breaking this module's documented no-invalidate contract. Range bounds
  // are the SSOT predicate shared with validateThresholds so they cannot drift.
  if (!isThresholdValueInRange(camel, value)) {
    warnDroppedOverride(envKey, `value "${rawValue}" is out of range`)
    return thresholds
  }
  return { ...thresholds, [camel]: value }
}

function applyFeatureOverride(
  features: FeatureFlags,
  envKey: string,
  rawValue: string,
): FeatureFlags {
  const camel = screamingSnakeToCamel(envKey.slice(FEATURE_PREFIX.length))
  if (!VALID_FEATURE_KEYS.has(camel as keyof FeatureFlags)) {
    warnDroppedOverride(envKey, `unknown feature flag "${camel}"`)
    return features
  }
  const value = parseBooleanEnv(rawValue)
  if (value === undefined) {
    warnDroppedOverride(envKey, `value "${rawValue}" is not a recognized boolean`)
    return features
  }
  return { ...features, [camel]: value }
}

/**
 * Map of `ARBITER_<TOP_FIELD>` env keys to (config patcher) functions.
 * Top-level overrides are deliberately limited to a curated allow-list to
 * avoid corruption of nested objects (which require their own prefixes).
 */
const THRESHOLD_KEYS: ReadonlyArray<keyof ThresholdsV2> = [
  'lineCoverage',
  'branchCoverage',
  'mutationScore',
  'cyclomaticComplexity',
  'methodLength',
  'maxParams',
]

/**
 * #1618 — true when `thresholds` deep-equals the auto-derived default block for
 * `level`. Used to decide whether a governance-level env bump may safely
 * re-derive thresholds (auto-derived ⇒ yes) or must leave a custom block intact
 * (and warn that the half-upgrade is observable).
 */
function thresholdsAreDefaultFor(thresholds: ThresholdsV2, level: GovernanceLevel): boolean {
  const def = DEFAULT_THRESHOLDS[level]
  return THRESHOLD_KEYS.every((k) => thresholds[k] === def[k])
}

function applyTopLevelOverride(
  cfg: ArbiterConfigV2,
  envKey: string,
  rawValue: string,
): ArbiterConfigV2 {
  // Strip prefix only: "ARBITER_"
  const tail = envKey.slice('ARBITER_'.length)
  const camel = screamingSnakeToCamel(tail)
  if (camel === 'governanceLevel') {
    if (rawValue === 'L1' || rawValue === 'L2' || rawValue === 'L3' || rawValue === 'L4') {
      const oldLevel = cfg.governanceLevel
      const next: ArbiterConfigV2 = { ...cfg, governanceLevel: rawValue }
      if (rawValue === oldLevel) return next
      // #1618 — autoFillThresholds only fills when thresholds === undefined, so a
      // file-backed config carries the OLD level's numbers. Bumping the level alone
      // would tighten level-derived behaviour while coverage/complexity/mutation stay
      // at the weaker old bar — a silent half-upgrade. Re-derive when the stored block
      // is the auto-derived default; otherwise keep the custom block but make the
      // mismatch observable via the same channel as warnDroppedOverride.
      if (thresholdsAreDefaultFor(cfg.thresholds, oldLevel)) {
        return { ...next, thresholds: { ...DEFAULT_THRESHOLDS[rawValue] } }
      }
      warnDroppedOverride(
        envKey,
        `level bumped ${oldLevel}→${rawValue} but custom thresholds were kept — coverage/complexity bars still reflect ${oldLevel}`,
      )
      return next
    }
  }
  // Other top-level scalars are not exposed via this loose prefix to avoid
  // accidental corruption of arrays/objects.
  return cfg
}

/**
 * Apply environment overrides on top of a fully-migrated v2 config.
 *
 * Returns a new config (input is never mutated). Unknown / malformed env
 * vars are ignored silently — the env layer is meant to be safe to opt into.
 */
export function applyEnvOverrides(cfg: ArbiterConfigV2, env: Env): ArbiterConfigV2 {
  let thresholds: ThresholdsV2 = { ...cfg.thresholds }
  let features: FeatureFlags = { ...cfg.features }
  let next: ArbiterConfigV2 = { ...cfg, thresholds, features }

  for (const [key, rawValue] of Object.entries(env)) {
    if (rawValue === undefined) continue
    if (!key.startsWith('ARBITER_')) continue

    if (key.startsWith(THRESHOLD_PREFIX)) {
      thresholds = applyThresholdOverride(thresholds, key, rawValue)
      next = { ...next, thresholds }
      continue
    }
    if (key.startsWith(FEATURE_PREFIX)) {
      features = applyFeatureOverride(features, key, rawValue)
      next = { ...next, features }
      continue
    }
    // Reserved prefix used by harness — not a config override.
    if (key === 'ARBITER_NO_EVIDENCE') continue

    // Loose top-level pattern: ARBITER_<TOP_FIELD>
    next = applyTopLevelOverride(next, key, rawValue)
  }

  return next
}
