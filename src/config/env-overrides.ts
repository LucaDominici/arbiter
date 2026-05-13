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

import { parseBooleanEnv } from '../utils/env.js'
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

function applyThresholdOverride(
  thresholds: ThresholdsV2,
  envKey: string,
  rawValue: string,
): ThresholdsV2 {
  const camel = screamingSnakeToCamel(envKey.slice(THRESHOLD_PREFIX.length))
  if (!VALID_THRESHOLD_KEYS.has(camel as keyof ThresholdsV2)) {
    return thresholds
  }
  const value = parseNumericEnv(rawValue)
  if (value === undefined) return thresholds
  return { ...thresholds, [camel]: value }
}

function applyFeatureOverride(
  features: FeatureFlags,
  envKey: string,
  rawValue: string,
): FeatureFlags {
  const camel = screamingSnakeToCamel(envKey.slice(FEATURE_PREFIX.length))
  if (!VALID_FEATURE_KEYS.has(camel as keyof FeatureFlags)) {
    return features
  }
  const value = parseBooleanEnv(rawValue)
  if (value === undefined) return features
  return { ...features, [camel]: value }
}

/**
 * Map of `ARBITER_<TOP_FIELD>` env keys to (config patcher) functions.
 * Top-level overrides are deliberately limited to a curated allow-list to
 * avoid corruption of nested objects (which require their own prefixes).
 */
function applyTopLevelOverride(
  cfg: ArbiterConfigV2,
  envKey: string,
  rawValue: string,
): ArbiterConfigV2 {
  // Strip prefix only: "ARBITER_"
  const tail = envKey.slice('ARBITER_'.length)
  const camel = screamingSnakeToCamel(tail)
  if (camel === 'governanceLevel') {
    if (rawValue === 'L1' || rawValue === 'L2' || rawValue === 'L3') {
      return { ...cfg, governanceLevel: rawValue }
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
