// SPDX-License-Identifier: Apache-2.0
//
// #1288 — runtime ShipProfile for `arbiter ship`.
//
// The ship orchestrator (task-ship.ts) is the dual-side SSOT for deterministic sequencing
// (ADR-093). To run against ANY consumer repo — not just arbiter-self — it must read the
// TARGET repo's arbiter.json (collaborationMode, mergeMode, governanceLevel) instead of
// assuming arbiter's own trunk-solo config, and it must SKIP the self-only authoring gates
// (template-authoring, selfOnly invariants, matrix-fixtures) rather than fake them in a
// consumer repo (INV-115 / ADR-093 §5).
//
// Existing Code Survey (CANON-16): the collaboration-axis resolvers
// (resolveCollaborationMode / resolveDefaultMergeMode) already canonicalize the mode +
// default mergeMode (ADR-051 single derivation site) — REUSED here, not re-derived.
// resolveProjectConfig builds a full ProjectConfig by running every on-disk detector, far
// too heavy for a per-invocation ship read and owned by init/update/diff; this module is the
// lightweight runtime analogue (config → 4-field profile). New file justified: distinct
// responsibility (runtime profile) vs task-ship.ts's pure step sequencing.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { loadConfig } from '../utils/config.js'
import { resolveCompanions, type ActiveCompanion } from '../integrations/companions.js'
import { getLogger } from '../utils/logger.js'
import {
  resolveCollaborationMode,
  resolveDefaultMergeMode,
} from '../config/collaboration-mode-defaults.js'
import { resolveSetting } from '../config/override-resolver.js'
import { assertOverridablePath, parseValue } from './configure.js'
import { writeOverride } from './task-state.js'
import type { CollaborationMode, SoloMergeMode, GovernanceLevel } from '../wizard/types.js'
import {
  AUTONOMY_LEVELS,
  VALID_GATE_LEVELS,
  type AutonomyLevel,
  type GateLevel,
} from '../config/schema.js'

/** #1305 — the unified config path for the ship autonomy knob (`--autonomy` desugars here). */
const AUTONOMY_PATH = 'automation.autonomy'
/** #1306 — the unified config paths for the three Project-Profile orchestration prefs. */
const MAX_PARALLEL_WORKTREES_PATH = 'automation.maxParallelWorktrees'
const DEFAULT_GATE_LEVEL_PATH = 'automation.defaultGateLevel'
const AFFINITY_BATCHING_PATH = 'automation.affinityBatching'

export interface BuildShipOverridesInput {
  /** Raw `--set path=value` assignments (repeatable). */
  sets?: string[]
  /** `--autonomy <level>` ergonomic sugar — desugars to `--set automation.autonomy=<level>`. */
  autonomy?: string
}

/**
 * #1305 (ADR-094 §Decision.2) — turn `--set`/`--autonomy` into a validated per-run overrides map
 * AND persist it to the session layer so the override survives a mid-wave `/clear` (the `tier`
 * precedent). Each path is gated by `assertOverridablePath` (RT-01: a non-overridable path like
 * `governanceLevel` is refused) and value-checked by the catalog's `parseValue` (same validator as
 * `arbiter configure`). `--autonomy` is pure sugar; an explicit `--set automation.autonomy=…` wins
 * if both are given. Throws on an invalid path/value so the CLI surfaces a clear error pre-ship.
 */
export function buildShipOverrides(
  root: string,
  input: BuildShipOverridesInput,
): Record<string, string> {
  const overrides: Record<string, string> = {}
  if (input.autonomy !== undefined) overrides[AUTONOMY_PATH] = input.autonomy
  for (const assignment of input.sets ?? []) {
    const eqIdx = assignment.indexOf('=')
    if (eqIdx < 0) {
      throw new Error(`Invalid --set "${assignment}" — expected <path>=<value>.`)
    }
    const path = assignment.slice(0, eqIdx)
    const rawValue = assignment.slice(eqIdx + 1)
    assertOverridablePath(path)
    parseValue(path, rawValue) // throws on an invalid value (reused catalog validator)
    overrides[path] = rawValue
  }
  for (const [path, value] of Object.entries(overrides)) {
    assertOverridablePath(path) // belt-and-braces before persisting (RT-01)
    writeOverride(root, path, value)
  }
  return overrides
}

/** #1305 — fold the legacy `autonomyOverride` sugar into the generic `overrides` map. */
function buildOverrides(opts: ResolveShipProfileOptions): Record<string, string> | undefined {
  const merged: Record<string, string> = { ...(opts.overrides ?? {}) }
  if (opts.autonomyOverride !== undefined && merged[AUTONOMY_PATH] === undefined) {
    merged[AUTONOMY_PATH] = opts.autonomyOverride
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

/** The unique npm package name of arbiter-self — the authoritative self-detection signal. */
const ARBITER_SELF_PACKAGE = '@arbiter/cli'

/** The arbiter authoring-side gates that are self-only-forever (ADR-093 §5). */
export const SELF_ONLY_GATES = [
  'template-authoring',
  'selfOnly-invariants',
  'matrix-fixtures',
] as const

/** The runtime profile the ship engine resolves from the target repo's arbiter.json. */
export interface ShipProfile {
  /** True only for the arbiter repo itself (drives the self-only authoring gates). */
  isArbiterSelf: boolean
  collaborationMode: CollaborationMode
  mergeMode: SoloMergeMode
  governanceLevel: GovernanceLevel
  /** #1291 — resolved ship autonomy (flag > arbiter.json automation.autonomy > L0). */
  autonomy: AutonomyLevel
  /**
   * #1306 (ADR-094 §Decision.4) — the three Project-Profile orchestration prefs,
   * each resolved through the SAME unified precedence resolver as autonomy
   * (override → session → profile → derived floor). The wave reads
   * maxParallelWorktrees, verification reads defaultGateLevel, ship reads
   * affinityBatching — all from this one resolved profile, never a bespoke chain.
   */
  maxParallelWorktrees: number
  defaultGateLevel: GateLevel
  affinityBatching: boolean
  /**
   * #1730 — companion plugins active for this ship run (ponytail, …), resolved HOME-ONLY and
   * empty on arbiter-self. Consumed by the green-phase action (drafting instruction) and the
   * `Companion:` announcement. Empty ⇒ ship behaviour is byte-identical to a companion-free run.
   */
  companions: readonly ActiveCompanion[]
}

/** Ship behaviors gated by the autonomy level (ADR-093 §4). */
export type ShipBehavior =
  | 'auto-advance'
  | 'auto-merge'
  | 'fix-on-red-attempt'
  | 'wave-batch'
  | 'fix-on-red-autopush'
  | 'subagent-auto-spawn'

/**
 * #1291 — exact grant set per level. Every adjacent pair differs mechanically
 * (no map-fiction, INV-115): L0 asks at each step; L1 auto-advances and
 * auto-merges on green but STOPS at the fix decision (ask-on-risky); L2 also
 * attempts the fix autonomously (stop-on-red = decide+fix, push needs a human);
 * L3 adds wave/batch, autonomous fix push, and per-issue sub-agent auto-spawn.
 * Floor invariants (2-strike, reproduce-before-push, no --no-verify, no
 * commit-to-main) are NOT behaviors — no grant can disable them.
 */
const AUTONOMY_GRANTS: Record<AutonomyLevel, ReadonlySet<ShipBehavior>> = {
  L0: new Set<ShipBehavior>(),
  L1: new Set<ShipBehavior>(['auto-advance', 'auto-merge']),
  L2: new Set<ShipBehavior>(['auto-advance', 'auto-merge', 'fix-on-red-attempt']),
  L3: new Set<ShipBehavior>([
    'auto-advance',
    'auto-merge',
    'fix-on-red-attempt',
    'wave-batch',
    'fix-on-red-autopush',
    'subagent-auto-spawn',
  ]),
}

/** True when `level` authorizes `behavior` (ADR-093 §4 table). */
export function autonomyAllows(level: AutonomyLevel, behavior: ShipBehavior): boolean {
  return AUTONOMY_GRANTS[level].has(behavior)
}

export interface ResolveShipProfileOptions {
  /**
   * #1291 — per-run `--autonomy` override (ergonomic sugar). Desugars to
   * `overrides['automation.autonomy']`; invalid values are warn-ignored (fail-closed).
   * Retained for source-compatibility; the engine speaks the generic `overrides` map.
   */
  autonomyOverride?: string
  /**
   * #1305 (ADR-094 §Decision.2) — generic per-run `--set <path>=<value>` overrides, gated by
   * OVERRIDABLE_PATHS at the CLI boundary. Resolved through the unified precedence resolver.
   */
  overrides?: Record<string, string>
  /**
   * #1730 — the Claude home scanned for installed companion plugins. Defaults to `~/.claude`;
   * tests inject an isolated dir for determinism. This is the ONLY tree read for companions —
   * the target repo is never scanned (spoofing guard).
   */
  claudeHome?: string
}

function isAutonomyLevel(v: unknown): v is AutonomyLevel {
  return AUTONOMY_LEVELS.includes(v as AutonomyLevel)
}

/**
 * The consumer-safe default profile. Used when no arbiter.json is present/readable AND as the
 * omitted-profile default for the generic `shipSequence` preview, so a profile-blind caller
 * NEVER leaks a self-only authoring gate (RT-07). Mirrors the resolver defaults: a repo with
 * no collaboration config defaults to peer-review (ADR-051), whose default mergeMode is pr-ff.
 */
export const CONSUMER_DEFAULT_PROFILE: ShipProfile = {
  isArbiterSelf: false,
  collaborationMode: 'peer-review',
  mergeMode: 'pr-ff',
  governanceLevel: 'L2',
  autonomy: 'L0',
  // #1306 — conservative floors matching the resolver's DERIVED_DEFAULTS table.
  maxParallelWorktrees: 1,
  defaultGateLevel: 'L1',
  affinityBatching: false,
  companions: [],
}

/**
 * Detect arbiter-self by its globally-unique npm package name. A consumer can never publish
 * `@arbiter/cli`, so this has no false-positives — unlike a path heuristic (src/templates),
 * which would mis-classify a fork/monorepo/vendored consumer and leak self-only gates (RT-04).
 * Rooted at `root` (never cwd-relative) and crash-safe: a missing or malformed package.json is
 * simply "not self" (RT-09).
 */
export function isArbiterSelf(root: string): boolean {
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath)) return false
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: unknown }
    return pkg.name === ARBITER_SELF_PACKAGE
  } catch {
    return false
  }
}

/**
 * Resolve the ShipProfile from the target repo at `root`. Crash-safe: `loadConfig` THROWS on
 * malformed/invalid arbiter.json (it returns null only when ABSENT), so a typo'd consumer
 * config must degrade to safe defaults rather than abort the ship (RT-01).
 *
 * collaborationMode is read via the canonical resolver. Note (RT-03): the legacy
 * `features.soloDevMode` alias is normalized away by `loadConfig` (it rebuilds `features` to the
 * fixed FeatureFlags set) and, for v1 configs, mapped to `collaborationMode` during migration —
 * so by the time the engine sees the config, the canonical `collaborationMode` field is the
 * single authoritative source. Bridging the dropped alias here would be dead code.
 */
export function resolveShipProfile(
  root: string,
  opts: ResolveShipProfileOptions = {},
): ShipProfile {
  const overrides = buildOverrides(opts)
  const self = isArbiterSelf(root)
  let config: ReturnType<typeof loadConfig>
  try {
    config = loadConfig(root)
  } catch (err) {
    // A malformed/invalid arbiter.json THROWS (only an absent file returns null). Degrade to the
    // consumer-safe profile — which always requires a PR + review, the cautious direction — but
    // WARN rather than silently honor wrong merge semantics: a silent default could auto-merge
    // where the user intended review. Never crash the ship over a config typo (RT-01).
    getLogger().warn(
      'ship.config_unreadable',
      { root },
      `could not read arbiter.json (${err instanceof Error ? err.message : String(err)}); using consumer-safe ship defaults`,
    )
    config = null
  }
  // #1305 — autonomy now resolves through the ONE unified precedence resolver
  // (override → session → profile → default). The profile-layer value is the one we
  // already read here, so a malformed config (config === null) contributes no profile
  // value and autonomy falls to override/session/default — consistent with the
  // whole-profile degrade above (RT-03).
  const autonomy = resolveAutonomy(root, overrides, config?.automation?.autonomy)
  // #1306 — resolve the three orchestration prefs through the SAME unified resolver,
  // each layered (override → session → profile → derived floor). The profile-layer
  // raw is the value we already read here (config?.automation?.*), so a malformed
  // config (config === null) contributes no profile value and each falls to
  // override/session/floor — consistent with the whole-profile degrade above (RT-03).
  const prefs = resolveProfilePrefs(root, overrides, config?.automation)
  // #1730 — companion plugins, resolved HOME-ONLY (never the target repo) and empty on self.
  // `config` may be null (absent/malformed) → no overrides, still resolves from home.
  const companions = resolveCompanions({
    self,
    claudeHome: opts.claudeHome ?? join(homedir(), '.claude'),
    ...(config?.companions ? { overrides: config.companions } : {}),
  })
  if (config === null) {
    return { ...CONSUMER_DEFAULT_PROFILE, isArbiterSelf: self, autonomy, ...prefs, companions }
  }
  return { ...collaborationProfile(config), isArbiterSelf: self, autonomy, ...prefs, companions }
}

/**
 * Build the (collaborationMode, mergeMode, governanceLevel) slice of a ShipProfile
 * from a loaded config. Extracted from resolveShipProfile to keep it under the
 * complexity ceiling; collaborationMode is read via the canonical ADR-051 resolver.
 */
function collaborationProfile(
  config: NonNullable<ReturnType<typeof loadConfig>>,
): Pick<ShipProfile, 'collaborationMode' | 'mergeMode' | 'governanceLevel'> {
  const collaborationMode = resolveCollaborationMode(
    config.collaborationMode !== undefined ? { collaborationMode: config.collaborationMode } : {},
  )
  return {
    collaborationMode,
    mergeMode: config.solo?.mergeMode ?? resolveDefaultMergeMode(collaborationMode),
    governanceLevel: config.governanceLevel,
  }
}

/**
 * #1306 — resolve the three Project-Profile orchestration prefs through the unified
 * resolver and narrow each to its domain type. `resolveSetting` only ever returns a
 * parseValue-valid value (positive int / 'L1'|'L2' / 'true'|'false') or the registered
 * floor, so each narrow is total; the guards are fail-closed belt-and-braces (RT-1306-05).
 */
function resolveProfilePrefs(
  root: string,
  overrides: Record<string, string> | undefined,
  profile:
    | { maxParallelWorktrees?: number; defaultGateLevel?: string; affinityBatching?: boolean }
    | undefined,
): Pick<ShipProfile, 'maxParallelWorktrees' | 'defaultGateLevel' | 'affinityBatching'> {
  const ctx = (profileValue: string | undefined): Parameters<typeof resolveSetting>[1] => ({
    root,
    ...(overrides !== undefined ? { overrides } : {}),
    ...(profileValue !== undefined ? { profileValue } : {}),
  })
  const mpwRaw = resolveSetting(
    MAX_PARALLEL_WORKTREES_PATH,
    ctx(profile?.maxParallelWorktrees?.toString()),
  )
  const gateRaw = resolveSetting(DEFAULT_GATE_LEVEL_PATH, ctx(profile?.defaultGateLevel))
  const affinityRaw = resolveSetting(
    AFFINITY_BATCHING_PATH,
    ctx(profile?.affinityBatching?.toString()),
  )
  const mpw = Number(mpwRaw)
  return {
    maxParallelWorktrees: Number.isInteger(mpw) && mpw >= 1 ? mpw : 1,
    defaultGateLevel: (VALID_GATE_LEVELS as readonly string[]).includes(gateRaw)
      ? (gateRaw as GateLevel)
      : 'L1',
    affinityBatching: affinityRaw === 'true',
  }
}

/**
 * #1305 — resolve the ship autonomy level through the unified resolver and narrow it to an
 * AutonomyLevel. `resolveSetting` only ever returns a value that passed parseValue (enum-checked)
 * or the L0 default, so the narrow is total; the guard is a fail-closed belt-and-braces (RT-02).
 */
function resolveAutonomy(
  root: string,
  overrides: Record<string, string> | undefined,
  profileValue: string | undefined,
): AutonomyLevel {
  const resolved = resolveSetting(AUTONOMY_PATH, {
    root,
    ...(overrides !== undefined ? { overrides } : {}),
    ...(profileValue !== undefined ? { profileValue } : {}),
  })
  return isAutonomyLevel(resolved) ? resolved : 'L0'
}
