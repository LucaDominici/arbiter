// SPDX-License-Identifier: Apache-2.0
/**
 * Migration: v1 ("0.1") → v2 ("0.2")
 *
 * Converts the legacy v1 flat-flag format into the canonical ArbiterConfigV2.
 * Also handles v2 ("0.2") input idempotently — validates and returns as-is
 * (with decomposition alias applied if absent).
 *
 * Issue: #231
 */

import type { AiTool, GovernanceLevel, ThresholdsV2 } from '../../wizard/types.js'
import {
  type ArbiterConfigV2,
  type DecompositionBackendId,
  type FeatureFlags,
  AI_TOOLS,
  DEFAULT_THRESHOLDS,
  GOVERNANCE_LEVELS,
  validateConfig,
} from '../schema.js'
import { getLogger } from '../../utils/logger.js'
import { levelAtLeast } from '../levels.js'

// ── helpers ──────────────────────────────────────────────────────────────────

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function warnUseGitHubDeprecated(): void {
  getLogger().warn(
    'config.useGitHub_deprecated',
    {},
    '`useGitHub` is deprecated. Use `permitGitHub` in arbiter.json and the `--github` flag for live API calls.',
  )
}

/**
 * Migrate `useGitHub` → `permitGitHub` for v2 configs that still carry the
 * old field name. Deletes `useGitHub` from the returned object to prevent
 * deprecation-warning loops on every subsequent load.
 */
function migratePermitGitHub(cfg: ArbiterConfigV2): ArbiterConfigV2 {
  const raw = cfg as unknown as Record<string, unknown>
  if (!('useGitHub' in raw)) return cfg
  const { useGitHub, ...rest } = raw
  if (!('permitGitHub' in rest)) {
    warnUseGitHubDeprecated()
    return { ...(rest as unknown as ArbiterConfigV2), permitGitHub: useGitHub as boolean }
  }
  return rest as unknown as ArbiterConfigV2
}

interface LegacyEvidenceRetention {
  enabled?: boolean
}

function deriveEvidenceHarness(evidenceRetention: unknown, level: GovernanceLevel): boolean {
  if (isRecord(evidenceRetention)) {
    const legacy = evidenceRetention as LegacyEvidenceRetention
    if (typeof legacy.enabled === 'boolean') {
      return legacy.enabled
    }
  }
  // #1732 Step 3: floor check (not `=== 'L3'`) — an L4 v1 config with no
  // explicit evidenceRetention must inherit the L3 default, not lose it
  // (same bug class as #1720).
  return levelAtLeast(level, 'L3')
}

function deriveFeatureFlags(raw: Record<string, unknown>, level: GovernanceLevel): FeatureFlags {
  const nonL1 = level !== 'L1'
  return {
    debtGates: typeof raw['enableDebtGates'] === 'boolean' ? raw['enableDebtGates'] : nonL1,
    securityScanning:
      typeof raw['enableSecurityScanning'] === 'boolean' ? raw['enableSecurityScanning'] : nonL1,
    suppressions: typeof raw['enableSuppressions'] === 'boolean' ? raw['enableSuppressions'] : true,
    mutationTesting: nonL1,
    contractTesting: typeof raw['contractType'] === 'string' && raw['contractType'] !== 'none',
    evidenceHarness: deriveEvidenceHarness(raw['evidenceRetention'], level),
    selfValidationHarness: true,
  }
}

function applyDecompositionAlias(cfg: ArbiterConfigV2): ArbiterConfigV2 {
  if (cfg.decomposition?.backend) return cfg
  const useGh = cfg.permitGitHub ?? cfg.useGitHub ?? false
  const backend: DecompositionBackendId = useGh ? 'github' : 'markdown'
  return { ...cfg, decomposition: { backend } }
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Migrates a v1 ("0.1") config to v2 ("0.2"), or returns a v2 input unchanged.
 *
 * @throws if the input is not a non-null object, or if a v2 input fails validation.
 */
export function migrateV1ToV2(raw: unknown): ArbiterConfigV2 {
  if (!isRecord(raw)) {
    throw new Error('arbiter.json must be a non-null object')
  }

  // ── already v2: migrate permitGitHub alias then pass through ─────────────
  if (raw['version'] === '0.2') {
    const result = validateConfig(raw)
    if (result.ok) {
      const migrated = migratePermitGitHub(result.config)
      return { ...applyDecompositionAlias(migrated), $schemaVersion: 2 }
    }
    // Never-brick (T0): a v0.2 config that fails STRICT validation here (e.g. a
    // removed/renamed enum value such as `contractType: 'pact'`, or any other
    // stale field) is NOT fatal at the migration layer. Migration's job is to
    // reshape, not gate-keep — throwing here would brick every historical config
    // before loadConfig's coercible-field fallback (sanitizeCoercibleFields)
    // ever gets a chance to run. Pass the raw shape through un-normalized; the
    // one authoritative validate-then-coerce-then-validate pass happens once,
    // at the end of the chain, in loadConfig().
    getLogger().warn(
      'config.v2_passthrough_invalid',
      { errors: result.errors.join('; ') },
      `arbiter.json (v0.2) failed strict validation (${result.errors.join('; ')}) — deferring to the migration fallback`,
    )
    const migrated = migratePermitGitHub(raw as unknown as ArbiterConfigV2)
    return { ...applyDecompositionAlias(migrated), $schemaVersion: 2 }
  }

  // ── v1 ("0.1") → v2 ("0.2") ──────────────────────────────────────────────
  const rawLevel = raw['governanceLevel']
  const upperLevel = typeof rawLevel === 'string' ? rawLevel.toUpperCase() : rawLevel
  let level: GovernanceLevel
  if (rawLevel === undefined) {
    level = 'L2'
  } else if (typeof upperLevel === 'string' && GOVERNANCE_LEVELS.has(upperLevel)) {
    level = upperLevel as GovernanceLevel
  } else {
    throw new Error(
      `arbiter.json governanceLevel must be one of L1, L2, L3, L4 — got ${typeof rawLevel === 'string' ? rawLevel : JSON.stringify(rawLevel)}`,
    )
  }

  const features: FeatureFlags = deriveFeatureFlags(raw, level)
  const thresholds: ThresholdsV2 = DEFAULT_THRESHOLDS[level]

  const stripKeys = new Set([
    'version',
    'enableDebtGates',
    'enableSecurityScanning',
    'enableSuppressions',
    'useGitHub',
  ])
  const rest = Object.fromEntries(Object.entries(raw).filter(([k]) => !stripKeys.has(k)))

  const permitGitHub = typeof raw['useGitHub'] === 'boolean' ? raw['useGitHub'] : false
  const migratedBackend: DecompositionBackendId = permitGitHub ? 'github' : 'markdown'

  // Preserve explicit decomposition if present (do not override)
  const decomposition: { backend: DecompositionBackendId } =
    isRecord(raw['decomposition']) && raw['decomposition']['backend']
      ? (raw['decomposition'] as { backend: DecompositionBackendId })
      : { backend: migratedBackend }

  return {
    ...rest,
    version: '0.2',
    $schemaVersion: 2,
    tools: Array.isArray(raw['tools'])
      ? (raw['tools'] as unknown[]).filter((t): t is AiTool => AI_TOOLS.has(t as string))
      : (['claude', 'codex'] as AiTool[]),
    governanceLevel: level,
    permitGitHub,
    decomposition,
    features,
    thresholds,
  }
}
