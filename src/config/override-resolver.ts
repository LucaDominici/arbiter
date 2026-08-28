// SPDX-License-Identifier: Apache-2.0
//
// #1305 (ADR-094 §Decision.3) — the ONE precedence resolver for per-run settable paths.
//
// Replaces the scattered inline `flag ?? session ?? config ?? default` chains (the smell
// ADR-094 retires) with a single `resolveSetting(path, ctx)` that layers, in order:
//
//   per-run override (--set / alias)  →  session (.claude/.task/status.json)
//     →  env + arbiter.json profile (loadConfig already folds applyEnvOverrides, env first)
//     →  derived default (collaboration-mode-defaults.ts, the ADR-051 single derivation site)
//
// Every candidate is validated through the SAME `parseValue` the `arbiter configure` catalog
// uses; an invalid candidate at any layer is warn-skipped (fail-closed, RT-02) so a stale
// session value or a typo'd override can never harden into the resolved setting — the resolver
// simply falls through to the next layer and never throws on a bad value.
//
// Existing Code Survey (CANON-16): no module owned cross-layer precedence generically (each
// setting inlined its own chain). The pure derived-default TABLE in collaboration-mode-defaults.ts
// is imported here, not extended, to keep that module side-effect-free and avoid a config↔commands
// cycle. parseValue + readOverride are REUSED, not re-implemented.
import { loadConfig } from '../utils/config.js'
import { getLogger } from '../utils/logger.js'
import { parseValue } from '../commands/configure.js'
import { readOverride } from '../commands/task-state.js'
import { DEFAULT_AUTONOMY } from './collaboration-mode-defaults.js'

/**
 * The derived default for each resolvable path (the ADR-051/094 single default site).
 * #1306 — the orchestration prefs register CONSERVATIVE FLOORS here: these are the
 * values a profile-blind read (no persisted value, no override) lands on, so the
 * resolver never throws "no derived default" for them (RT-1306-04). The richer
 * per-collaboration-mode derivations are persisted by the init wizard
 * (collaboration-mode-defaults.ts); this table is the absolute safe floor only.
 *
 * #2333 — the keys track OVERRIDABLE_PATHS: this resolver serves per-run settable
 * paths only, so a floor for a path nothing can override is dead config. Adding one
 * here without a matching OVERRIDABLE_PATHS entry (or vice versa) is what let the
 * unread `automation.maxParallelWorktrees` residual survive #2329 — pinned by
 * __tests__/config/ship-profile-mpw-removed.test.ts.
 */
const DERIVED_DEFAULTS: Record<string, string> = {
  'automation.autonomy': DEFAULT_AUTONOMY,
  'automation.defaultGateLevel': 'L1',
  'crossModelReview.enabled': 'false',
}

export interface ResolveSettingContext {
  /** Target repo root whose session + arbiter.json feed the lower layers. */
  root: string
  /** Per-run overrides for THIS invocation (highest precedence): config-path → raw value. */
  overrides?: Record<string, string> | undefined
  /**
   * The profile-layer raw value the caller already read from its own loadConfig pass (so a
   * shared config load is not duplicated and a malformed-config degrade stays consistent across
   * the whole profile — RT-03). When omitted, the resolver loads the config itself (crash-safe).
   */
  profileValue?: string | undefined
}

/** Read the raw profile value for `path` from the target repo's arbiter.json (env-folded). */
function profileRawValue(root: string, path: string): string | undefined {
  let config: ReturnType<typeof loadConfig>
  try {
    config = loadConfig(root)
  } catch {
    // Malformed arbiter.json — treat as absent (the profile layer contributes nothing);
    // the derived default takes over. Never crash the resolver over a config typo (RT-02).
    return undefined
  }
  if (config === null) return undefined
  const raw = config as unknown as Record<string, unknown>
  // Dot-path traversal (max depth 2, mirroring the configure catalog's applySet shape).
  const parts = path.split('.')
  let cursor: unknown = raw
  for (const part of parts) {
    if (typeof cursor !== 'object' || cursor === null) return undefined
    cursor = (cursor as Record<string, unknown>)[part]
  }
  // Only scalar leaves are settable values; an object/array leaf means the path does not point at
  // a settable scalar — treat as absent so the next layer applies (never stringify an object).
  if (typeof cursor === 'string') return cursor
  if (typeof cursor === 'number' || typeof cursor === 'boolean') return String(cursor)
  return undefined
}

/**
 * Validate a candidate raw value for `path`; return it iff valid, else warn + undefined so the
 * caller falls through to the next layer (fail-closed). parseValue is the catalog's own validator.
 */
function validCandidate(path: string, raw: string | undefined, layer: string): string | undefined {
  if (raw === undefined) return undefined
  try {
    parseValue(path, raw)
    return raw
  } catch {
    getLogger().warn(
      'override.invalid_candidate',
      { path, raw, layer },
      `ignoring invalid ${path}="${raw}" from ${layer} layer; falling through (fail-closed)`,
    )
    return undefined
  }
}

/**
 * Resolve the effective value of a settable `path` through the unified precedence stack.
 * Returns the raw string at the winning layer (the caller narrows it to its domain type).
 */
export function resolveSetting(path: string, ctx: ResolveSettingContext): string {
  // 1. Per-run override (--set / alias) — highest precedence.
  const fromOverride = validCandidate(path, ctx.overrides?.[path], 'override')
  if (fromOverride !== undefined) return fromOverride

  // 2. Session layer — a value persisted by a prior --set/--autonomy that survives /clear.
  const fromSession = validCandidate(path, readOverride(ctx.root, path), 'session')
  if (fromSession !== undefined) return fromSession

  // 3. Env + arbiter.json profile (loadConfig folds applyEnvOverrides, env first).
  const profileRaw = ctx.profileValue ?? profileRawValue(ctx.root, path)
  const fromProfile = validCandidate(path, profileRaw, 'profile')
  if (fromProfile !== undefined) return fromProfile

  // 4. Derived default — the ADR-051/094 single default site.
  const fallback = DERIVED_DEFAULTS[path]
  if (fallback === undefined) {
    throw new Error(`resolveSetting: no derived default registered for path "${path}"`)
  }
  return fallback
}
