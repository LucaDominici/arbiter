// SPDX-License-Identifier: Apache-2.0
import { resolve, join, relative } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { saveConfig } from '../utils/config.js'
import {
  validateConfig,
  VALID_COLLABORATION_MODES,
  VALID_SOLO_MERGE_MODES,
  VALID_BRANCHING_STRATEGIES,
  AUTONOMY_LEVELS,
  VALID_GATE_LEVELS,
  DEFAULT_CROSS_MODEL_REVIEW,
} from '../config/schema.js'
import { acquireLock } from '../utils/file-lock.js'
import { jsonOutput } from '../utils/json-output.js'
import { deriveAxisDefaults } from '../detectors/axis.js'
import { ArbiterError } from '../utils/errors.js'
import type { ArbiterConfigV2 } from '../config/schema.js'
import { SUPPORTED_AI_TOOLS } from '../wizard/types.js'
import type { Archetype } from '../wizard/types.js'
import type { ProjectPreset } from '../wizard/types.js'
import { t } from '../i18n/index.js'
import { ensureDir, readFileTranslated, writeFile } from '../utils/fs.js'
import { resolveMaxParallelWorktrees } from '../config/collaboration-mode-defaults.js'
import { migrate } from '../config/migrations/index.js'

export interface ConfigureOptions {
  dir?: string | undefined
  sets: string[]
  json?: boolean | undefined
  preset?: string | undefined
}

type ApplicablePreset = Exclude<ProjectPreset, 'none'>

function changed(path: string, current: unknown, next: unknown): string[] {
  return current === next ? [] : [`${path}=${String(next)}`]
}

/** The existing init presets expressed through configure's canonical writer. */
export function assignmentsForPreset(config: ArbiterConfigV2, preset: ApplicablePreset): string[] {
  if (preset === 'solo-homelab') {
    const assignments = [
      ...changed('features.iso27001Mapping', config.features.iso27001Mapping, false),
      ...changed('features.nis2Mapping', config.features.nis2Mapping, false),
      ...changed('features.gdprMapping', config.features.gdprMapping, false),
      ...changed('features.riskRegister', config.features.riskRegister, false),
      ...changed('features.mutationTesting', config.features.mutationTesting, false),
      ...changed('features.evidenceHarness', config.features.evidenceHarness, false),
      ...changed('features.operationsHandbook', config.features.operationsHandbook, false),
      ...changed('industryOverlay', config.industryOverlay, 'none'),
    ]
    return config.governanceLevel === 'L3' || config.governanceLevel === 'L4'
      ? [...assignments, 'governanceLevel=L2']
      : assignments
  }
  return [
    ...changed('features.iso27001Mapping', config.features.iso27001Mapping, true),
    ...changed('features.nis2Mapping', config.features.nis2Mapping, true),
    ...changed('features.gdprMapping', config.features.gdprMapping, true),
    ...changed('features.riskRegister', config.features.riskRegister, true),
    ...changed('features.evidenceHarness', config.features.evidenceHarness, true),
    ...changed('features.operationsHandbook', config.features.operationsHandbook, true),
    ...changed('features.mcpFallback', config.features.mcpFallback, true),
  ]
}

// Exported so `arbiter settings` (#1121) and check-settings-coverage.mjs can
// enforce that every settable path is surfaced in the settings catalog.
export const ALLOWED_PATHS = new Set([
  'projectName',
  'language',
  'packageManager',
  'databaseEngine',
  'acceptBetaTools',
  'decomposition.backend',
  'features.contractTesting',
  'features.mutationTesting',
  'features.securityScanning',
  'features.evidenceHarness',
  'features.acceptanceAnchor',
  'features.debtGates',
  'features.suppressions',
  'features.soloDevMode',
  'features.selfValidationHarness',
  'features.auditToolchain',
  'features.fiveLaneCi',
  'features.mcpFallback',
  'features.noSkippedTests',
  // #1887-A: these 3 had generators built + gated on the ProjectConfig field
  // but no public activation path at all (recipe field added alongside).
  'features.codeownersNotify',
  'features.taxonomy25d',
  'features.perfTesting',
  // #1887 (Finding-A residual): these 5 had persistence + read-back but no
  // individual activation path — only `--preset industrial-grade` set them.
  'features.riskRegister',
  'features.operationsHandbook',
  'features.iso27001Mapping',
  'features.nis2Mapping',
  'features.gdprMapping',
  'collaborationMode',
  'solo.mergeMode',
  'branchingStrategy',
  'thresholds.lineCoverage',
  'thresholds.branchCoverage',
  'thresholds.mutationScore',
  'thresholds.cyclomaticComplexity',
  'thresholds.methodLength',
  'thresholds.maxParams',
  'governanceLevel',
  'permitGitHub',
  'tools',
  'archetype',
  'architectureStyle',
  'isMultiTenant',
  'hasDatabase',
  'hasPublicApi',
  'contractType',
  'automation.autonomy',
  // #1306 (ADR-094 §Decision.4) — Project-Profile orchestration prefs.
  'automation.maxParallelWorktrees',
  'automation.defaultGateLevel',
  'runnerProfile',
  'channel',
  'evidenceRetention',
  'thresholdProfile',
  'strictnessTier',
  'industryOverlay',
  'basePackage',
  'deployTarget',
  'invariantTiers',
  'worktree',
  'plugins',
  'companions',
  'lanes',
  'taskTiers',
  'taxonomy.domainDims',
  'observability.provider',
  'auth.provider',
  'auth.tenantIsolation',
  'frontend.framework',
  'frontend.stateManager',
  'frontend.validationLib',
  'governance.invariants_catalog',
  'governance.constraintScan',
  'governance.ssotGuardPatterns',
  'governance.projectInvariants',
  'governance.liveSsot',
  'conformanceThresholds',
  'smokeJourneys.requiredJourneys',
  'e2ePolicy.escalation.strikes',
  'e2ePolicy.escalation.maxStrikes',
  'ship.train.maxChain',
  'ship.train.maxAgeMinutes',
  'ship.review.maxRounds',
  'crossModelReview.enabled',
  'crossModelReview.diffEgressConsent',
  'crossModelReview.providers',
  'crossModelReview.slots.codeReview',
  'crossModelReview.slots.redTeamReview',
  'crossModelReview.timeoutMs',
  'crossModelReview.onUnavailable',
])

/**
 * #1305 (ADR-094 §Decision.2): the curated subset of ALLOWED_PATHS that a SINGLE
 * `arbiter ship` run may override via `--set <path>=<value>` (or an ergonomic alias
 * such as `--autonomy`). Deliberately NOT all of ALLOWED_PATHS — persistent project
 * identity (governanceLevel, archetype, collaborationMode, …) must NOT be per-run
 * flippable. Every entry MUST also be in ALLOWED_PATHS (asserted in tests) so the same
 * parseValue validators apply, AND must have a reader that observes it within the run:
 * a path accepted per-run and then ignored is the #2329/#2333 accept-then-ignore bug.
 */
export const OVERRIDABLE_PATHS = new Set([
  'automation.autonomy',
  // #1306 — the gate level is per-run overridable (like autonomy): a single
  // ship/wave/verify run may dial it. Read by verification via ShipProfile.
  // #2333 — `automation.maxParallelWorktrees` was here and is NOT any more: #2329
  // deleted its only ship-side reader, so `--set`ting it changed nothing about the
  // run. It survives as a PERSISTENT knob (`arbiter configure`, ALLOWED_PATHS above)
  // read by doctor profile-coherence and the wizard coherence check.
  'automation.defaultGateLevel',
  // #2356 — a run may opt into the already-consented reviewer; consent itself
  // is persistent and cannot be granted by a per-run override.
  'crossModelReview.enabled',
])

/**
 * #1305 (RT-01): reject any path that is not a curated per-run override target
 * BEFORE it can be validated, persisted to the session layer, or resolved. This is
 * the single guard that keeps `--set` from flipping non-overridable settings (e.g.
 * `--set governanceLevel=L1`). Unknown paths fail the same way as non-overridable ones.
 */
export function assertOverridablePath(path: string): void {
  if (!OVERRIDABLE_PATHS.has(path)) {
    throw ArbiterError.fromKey(
      'E_UNKNOWN_PATH',
      'errors.E_UNKNOWN_PATH',
      { path },
      {
        hint: `Per-run --set is limited to: ${[...OVERRIDABLE_PATHS].join(', ')}. Persistent settings change via \`arbiter configure\`.`,
      },
    )
  }
}

// #2417 (ADR-095): must agree with `init --tools` (parseTools) — the same
// customer-facing set, from the same SSOT. configure previously accepted the
// full experimental set here, contradicting ADR-095's "every other site
// references it" mandate.
const VALID_TOOLS = new Set<string>(SUPPORTED_AI_TOOLS)

const VALID_ARCHETYPES = new Set([
  'backend-web-db',
  'cli',
  'library',
  'data-pipeline',
  'frontend-spa',
  'embedded',
])

const VALID_ARCHITECTURE_STYLES = new Set(['hexagonal', 'layered', 'modular-monolith', 'none'])

const VALID_CONTRACT_TYPES = new Set([
  'rest-owned',
  'rest-public',
  'graphql',
  'grpc',
  'message-queue',
  'none',
])

const CROSS_MODEL_BOOLEAN_PATHS = new Set([
  'crossModelReview.enabled',
  'crossModelReview.diffEgressConsent',
])
const CROSS_MODEL_SLOT_PATHS = new Set([
  'crossModelReview.slots.codeReview',
  'crossModelReview.slots.redTeamReview',
])

const BOOLEAN_PATHS = new Set(['permitGitHub', 'acceptBetaTools', 'auth.tenantIsolation'])

const JSON_PATHS = new Set([
  'evidenceRetention',
  'invariantTiers',
  'worktree',
  'plugins',
  'companions',
  'lanes',
  'taskTiers',
  'taxonomy.domainDims',
  'governance.ssotGuardPatterns',
  'governance.projectInvariants',
  'governance.liveSsot',
  'conformanceThresholds',
  'smokeJourneys.requiredJourneys',
  'e2ePolicy.escalation.strikes',
])

function parseJsonValue(path: string, raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw ArbiterError.fromKey(
      'E_INVALID_FORMAT',
      'errors.E_INVALID_FORMAT',
      { assignment: `${path}=${raw}` },
      { hint: `Provide valid JSON after ${path}=.` },
    )
  }
}

function parseAxisValue(path: string, raw: string): unknown {
  if (path === 'archetype') {
    if (!VALID_ARCHETYPES.has(raw))
      throw ArbiterError.fromKey(
        'E_INVALID_ARCHETYPE',
        'errors.E_INVALID_ARCHETYPE',
        {
          field: 'archetype',
          value: raw,
          valid: [...VALID_ARCHETYPES].join(', '),
        },
        { hint: 'Run `arbiter configure --help` for a list of valid archetypes.' },
      )
    return raw
  }
  if (path === 'architectureStyle') {
    if (!VALID_ARCHITECTURE_STYLES.has(raw))
      throw ArbiterError.fromKey(
        'E_INVALID_ARCHETYPE',
        'errors.E_INVALID_ARCHETYPE',
        {
          field: 'architectureStyle',
          value: raw,
          valid: [...VALID_ARCHITECTURE_STYLES].join(', '),
        },
        { hint: 'Run `arbiter configure --help` for valid architectureStyle values.' },
      )
    return raw
  }
  if (path === 'contractType') {
    if (!VALID_CONTRACT_TYPES.has(raw))
      throw ArbiterError.fromKey(
        'E_INVALID_ARCHETYPE',
        'errors.E_INVALID_ARCHETYPE',
        {
          field: 'contractType',
          value: raw,
          valid: [...VALID_CONTRACT_TYPES].join(', '),
        },
        { hint: 'Run `arbiter configure --help` for valid contractType values.' },
      )
    return raw
  }
  // isMultiTenant, hasDatabase, hasPublicApi
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw ArbiterError.fromKey(
    'E_INVALID_BOOL',
    'errors.E_INVALID_BOOL',
    { path, value: raw },
    {
      hint: 'Use `true` or `false` (lowercase).',
    },
  )
}

function parseCrossModelBoolean(path: string, raw: string): boolean {
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw ArbiterError.fromKey(
    'E_INVALID_BOOL',
    'errors.E_INVALID_BOOL',
    { path, value: raw },
    { hint: 'Use `true` or `false` (lowercase).' },
  )
}

function parseCrossModelProviders(raw: string): string[] {
  const providers = raw.split(',').map((provider) => provider.trim())
  if (providers.length === 1 && providers[0] === 'codex') return providers
  throw ArbiterError.fromKey(
    'E_INVALID_TOOL',
    'errors.E_INVALID_TOOL',
    { noun: 'provider', tool: JSON.stringify(raw), valid: 'codex' },
    { hint: 'The only supported cross-model provider is codex.' },
  )
}

function parseCrossModelNumber(path: string, raw: string): number {
  const value = Number(raw)
  const minimum = CROSS_MODEL_SLOT_PATHS.has(path) ? 0 : 1
  if (!Number.isInteger(value) || value < minimum) {
    throw ArbiterError.fromKey(
      'E_INVALID_NUMBER',
      'errors.E_INVALID_NUMBER',
      { path, value: raw },
      { hint: `Provide an integer >= ${minimum}.` },
    )
  }
  return value
}

function parseCrossModelPolicy(path: string, raw: string): string {
  if (raw === 'degrade' || raw === 'fail') return raw
  throw ArbiterError.fromKey(
    'E_INVALID_ARCHETYPE',
    'errors.E_INVALID_ARCHETYPE',
    { field: path, value: raw, valid: 'degrade, fail' },
    { hint: 'Use `degrade` or `fail`.' },
  )
}

function parseCrossModelValue(path: string, raw: string): unknown {
  if (CROSS_MODEL_BOOLEAN_PATHS.has(path)) return parseCrossModelBoolean(path, raw)
  if (path === 'crossModelReview.providers') return parseCrossModelProviders(raw)
  if (CROSS_MODEL_SLOT_PATHS.has(path) || path === 'crossModelReview.timeoutMs') {
    return parseCrossModelNumber(path, raw)
  }
  if (path === 'crossModelReview.onUnavailable') return parseCrossModelPolicy(path, raw)
  return raw
}

function parseFeatureValue(path: string, raw: string): boolean | null {
  if (!path.startsWith('features.')) return null
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw ArbiterError.fromKey(
    'E_INVALID_BOOL',
    'errors.E_INVALID_BOOL',
    { path: 'features.*', value: raw },
    {
      hint: 'Use `true` or `false` (lowercase). Example: `arbiter configure --set features.debtGates=true`.',
    },
  )
}

const AXIS_PATHS = new Set([
  'archetype',
  'architectureStyle',
  'isMultiTenant',
  'hasDatabase',
  'hasPublicApi',
  'contractType',
])

/**
 * Validate + coerce a raw `path=value` string for a settable path. Exported (#1305)
 * so the unified override resolver and the `--set` grammar reuse the SAME validators
 * as `arbiter configure` — one validation surface, no parallel re-implementation.
 */
export function parseValue(path: string, raw: string): unknown {
  const featureValue = parseFeatureValue(path, raw)
  if (featureValue !== null) return featureValue
  if (path.startsWith('thresholds.')) {
    const n = Number(raw)
    if (!Number.isFinite(n))
      throw ArbiterError.fromKey(
        'E_INVALID_NUMBER',
        'errors.E_INVALID_NUMBER',
        { path, value: raw },
        {
          hint: `Provide a numeric value. Example: \`arbiter configure --set ${path}=80\`.`,
        },
      )
    return n
  }
  if (BOOLEAN_PATHS.has(path)) return parseCrossModelBoolean(path, raw)
  if (JSON_PATHS.has(path)) return parseJsonValue(path, raw)
  if (path === 'tools') {
    const toolList = raw.split(',').map((tool) => tool.trim())
    for (const tool of toolList) {
      if (!VALID_TOOLS.has(tool)) {
        throw ArbiterError.fromKey(
          'E_INVALID_TOOL',
          'errors.E_INVALID_TOOL',
          {
            // The template owns no quotes; quote the single offending tool here.
            noun: 'tool',
            tool: `"${tool}"`,
            valid: [...VALID_TOOLS].join(', '),
          },
          { hint: `Valid tools: ${[...VALID_TOOLS].join(', ')}.` },
        )
      }
    }
    return toolList
  }
  if (path.startsWith('crossModelReview.')) return parseCrossModelValue(path, raw)
  if (AXIS_PATHS.has(path)) return parseAxisValue(path, raw)
  // #1306 — the two scalar automation prefs (int / bool) are validated in a helper
  // so parseValue stays within the complexity-15 limit. Returns undefined when the
  // path is not one of them (so the enum + raw fall-through below still apply).
  if (POSITIVE_INTEGER_PATHS.has(path)) return parsePositiveInteger(path, raw)
  // ADR-051 (#1119) / #1261 / #1306: enum-validate enum-shaped settable paths.
  const ENUM_PATHS = new Set([
    'collaborationMode',
    'solo.mergeMode',
    'branchingStrategy',
    'automation.autonomy',
    'automation.defaultGateLevel',
    'runnerProfile',
    'language',
    'packageManager',
    'databaseEngine',
    'decomposition.backend',
    'channel',
    'thresholdProfile',
    'strictnessTier',
    'industryOverlay',
    'deployTarget',
    'observability.provider',
    'auth.provider',
    'frontend.framework',
    'frontend.stateManager',
    'frontend.validationLib',
    'governance.invariants_catalog',
    'governance.constraintScan',
  ])
  if (ENUM_PATHS.has(path)) return parseEnumPathValue(path, raw)
  return raw
}

/** #1306 — the non-enum automation scalar prefs (positive-int). */
const POSITIVE_INTEGER_PATHS = new Set([
  'automation.maxParallelWorktrees',
  'ship.train.maxChain',
  'ship.train.maxAgeMinutes',
  'ship.review.maxRounds',
  'e2ePolicy.escalation.maxStrikes',
])

/**
 * #1306 — validate the scalar automation pref: maxParallelWorktrees is a positive
 * integer (rejects 0/negatives/floats). Extracted from parseValue to keep it under
 * the complexity ceiling.
 */
function parsePositiveInteger(path: string, raw: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    throw ArbiterError.fromKey(
      'E_INVALID_NUMBER',
      'errors.E_INVALID_NUMBER',
      { path, value: raw },
      {
        hint: `Provide a positive integer (≥1). Example: \`--set ${path}=3\`.`,
      },
    )
  }
  return n
}

/**
 * ADR-051 (#1119) / #1261: enum-validate enum-shaped settable paths
 * (collaboration axes + ship autonomy). Extracted from parseValue to keep it
 * below the 100-line / complexity-15 limits.
 */
function parseEnumPathValue(path: string, raw: string): string {
  const SPECS: Record<string, { valid: ReadonlySet<string>; hint: string }> = {
    collaborationMode: {
      valid: VALID_COLLABORATION_MODES,
      hint: 'Valid values: trunk-solo, peer-review, gated-review. Example: `arbiter configure --set collaborationMode=peer-review`.',
    },
    'solo.mergeMode': {
      valid: VALID_SOLO_MERGE_MODES,
      hint: 'Valid values: direct, pr-ff. Example: `arbiter configure --set solo.mergeMode=pr-ff`.',
    },
    branchingStrategy: {
      valid: VALID_BRANCHING_STRATEGIES,
      hint: 'Valid values: trunk-direct, github-flow, github-flow-with-develop.',
    },
    'automation.autonomy': {
      valid: new Set(AUTONOMY_LEVELS),
      hint: 'Valid values: L0, L1, L2, L3. L0 = ask each ship step (default). Per-run override: `arbiter ship --autonomy Lx`.',
    },
    // #1306 — defaultGateLevel is L1/L2 ONLY (the runnable gate levels), never L3/L4.
    'automation.defaultGateLevel': {
      valid: new Set(VALID_GATE_LEVELS),
      hint: 'Valid values: L1, L2. The gate level `arbiter verify` runs by default. Per-run override: `arbiter ship --set automation.defaultGateLevel=L2`.',
    },
    runnerProfile: {
      valid: new Set(['solo', 'fleet']),
      hint: 'Valid values: solo, fleet.',
    },
  }
  const spec = SPECS[path]
  if (spec !== undefined && !spec.valid.has(raw)) {
    throw ArbiterError.fromKey(
      'E_INVALID_ARCHETYPE',
      'errors.E_INVALID_ARCHETYPE',
      { field: path, value: raw, valid: [...spec.valid].join(', ') },
      { hint: spec.hint },
    )
  }
  return raw
}

/**
 * #504 — derive axis defaults from the (just-mutated) archetype and merge
 * them onto the draft, **only** for fields still undefined. This preserves
 * any explicit value (stored or same-batch --set), and persists fields that
 * were previously implicit so the on-disk config remains coherent after an
 * archetype change. Atomicity is provided by the single `saveConfig` write
 * downstream — no partial state ever lands on disk.
 */
function cascadeAxisDefaults(config: ArbiterConfigV2, archetype: Archetype): ArbiterConfigV2 {
  const defaults = deriveAxisDefaults(config, archetype)
  return {
    ...config,
    architectureStyle: config.architectureStyle ?? defaults.architectureStyle,
    isMultiTenant: config.isMultiTenant ?? defaults.isMultiTenant,
    hasDatabase: config.hasDatabase ?? defaults.hasDatabase,
    hasPublicApi: config.hasPublicApi ?? defaults.hasPublicApi,
    contractType: config.contractType ?? defaults.contractType,
  }
}

/**
 * #504 — apply a single `path=value` assignment to the draft and report
 * whether the archetype primary axis was touched (callers cascade derived
 * fields when so). Extracted from runConfigure to keep its complexity below
 * the 10-warning threshold.
 */
function applyAssignment(
  config: ArbiterConfigV2,
  assignment: string,
): { config: ArbiterConfigV2; archetypeTouched: boolean } {
  const eqIdx = assignment.indexOf('=')
  if (eqIdx < 0) {
    throw ArbiterError.fromKey(
      'E_INVALID_FORMAT',
      'errors.E_INVALID_FORMAT',
      { assignment },
      {
        hint: 'Example: `arbiter configure --set tools=claude,codex`.',
      },
    )
  }
  const path = assignment.slice(0, eqIdx)
  const rawValue = assignment.slice(eqIdx + 1)
  if (!ALLOWED_PATHS.has(path)) {
    throw ArbiterError.fromKey(
      'E_UNKNOWN_PATH',
      'errors.E_UNKNOWN_PATH',
      { path },
      {
        hint: 'Run `arbiter configure --help` to see valid paths.',
      },
    )
  }
  const value = parseValue(path, rawValue)
  return {
    config: applySet(config, path, value),
    archetypeTouched: path === 'archetype',
  }
}

function applyTopLevel(config: ArbiterConfigV2, key: string, value: unknown): ArbiterConfigV2 {
  return { ...config, [key]: value }
}

function setNested(current: unknown, parts: string[], value: unknown): unknown {
  const [head, ...tail] = parts
  if (head === undefined) return value
  const parent =
    current !== null && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {}
  return { ...parent, [head]: setNested(parent[head], tail, value) }
}

function applySet(config: ArbiterConfigV2, path: string, value: unknown): ArbiterConfigV2 {
  const parts = path.split('.')
  const [top, ...tail] = parts
  if (top === undefined || tail.length === 0) return applyTopLevel(config, path, value)
  const root = config as unknown as Record<string, unknown>
  const current =
    root[top] ?? (top === 'crossModelReview' ? structuredClone(DEFAULT_CROSS_MODEL_REVIEW) : {})
  return { ...config, [top]: setNested(current, tail, value) }
}

/**
 * #2546: the withheld half of a drain.md sync — `drainPath` (for naming the
 * file in the report) and `cap` (the value the user must now set by hand).
 * Returned ONLY when `writeFile` actually withheld the write; an ordinary
 * sync (or a no-op — content already matched) returns `null` and callers
 * stay silent, which is the CANON-24 inversion this type exists to protect.
 */
interface DrainSyncWithheld {
  drainPath: string
  cap: number
}

/**
 * Keep the materialized /drain default live for existing projects (#2344).
 *
 * #2546: `writeFile`'s `WriteResult` is inspected rather than discarded. At
 * this call site `withheld: true` can only ever mean the on-disk drain.md
 * carries the `arbiter:preserve` marker (see `src/utils/fs.ts` —
 * `resolveSessionSkip`'s withheld branch requires an active generation
 * session, and `configure` never opens one; this call also passes no
 * `session`/`skipIfExists`/`backup`). A preserve mark here is a legitimate
 * user action, not a failure: `drain.md` is a generator-emitted file a
 * downstream repo may deliberately hand-customise and freeze. So this does
 * NOT call `assertWritten` and does NOT throw — `syncDrainMaxParallel` is
 * called after `saveConfig` inside the same lock, and throwing would leave
 * `arbiter.json` persisted but the command reporting failure. Instead the
 * withheld outcome is returned for the caller to report as a warning while
 * `configure` still exits 0.
 */
function syncDrainMaxParallel(
  targetDir: string,
  config: ArbiterConfigV2,
): DrainSyncWithheld | null {
  const drainPath = join(targetDir, '.claude', 'commands', 'drain.md')
  if (!existsSync(drainPath)) return null
  const cap = resolveMaxParallelWorktrees({
    automation: config.automation,
    collaborationMode: config.collaborationMode,
    enableSoloDevMode: config.features.soloDevMode,
  })
  const before = readFileTranslated(drainPath, 'utf8')
  const after = before.replace(
    /^(\| `--max-parallel N` \|) [^|\r\n]+(\| Max worktree agents;.*)$/m,
    `$1 ${cap}       $2`,
  )
  if (after === before) return null
  const result = writeFile(drainPath, after)
  return result.withheld ? { drainPath, cap } : null
}

function resolvePreset(options: ConfigureOptions): ApplicablePreset | undefined {
  const preset =
    options.preset === 'industrial-grade' || options.preset === 'solo-homelab'
      ? options.preset
      : undefined
  if (options.preset !== undefined && preset === undefined) {
    throw ArbiterError.fromKey(
      'E_INVALID_FORMAT',
      'cli.configure.invalid_preset',
      { preset: options.preset },
      {
        hint: 'Use industrial-grade or solo-homelab.',
      },
    )
  }
  if (preset !== undefined && options.sets.length > 0) {
    throw ArbiterError.fromKey('E_INVALID_FORMAT', 'cli.configure.preset_set_conflict')
  }
  return preset
}

interface ConfigureMutation {
  updated: string[]
  changedConfig: boolean
  drainWithheld: DrainSyncWithheld | null
}

async function mutateConfig(
  targetDir: string,
  configPath: string,
  sets: string[],
  preset: ApplicablePreset | undefined,
): Promise<ConfigureMutation> {
  ensureDir(join(targetDir, '.arbiter'))
  const lock = await acquireLock(join(targetDir, '.arbiter', '.lock'))
  try {
    // The lock covers the raw read and write. Using loadConfig here would persist
    // process.env overrides and allow concurrent writers to lose one another's update.
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as unknown
    let config = migrate(raw)
    const updated = preset === undefined ? sets : assignmentsForPreset(config, preset)
    let archetypeTouched = false
    for (const assignment of updated) {
      const next = applyAssignment(config, assignment)
      config = next.config
      if (next.archetypeTouched) archetypeTouched = true
    }
    if (archetypeTouched && config.archetype !== undefined) {
      config = cascadeAxisDefaults(config, config.archetype)
    }
    if (preset !== undefined) config = { ...config, preset }

    const result = validateConfig(config)
    if (!result.ok) {
      throw ArbiterError.fromKey(
        'E_CONFIG_INVALID',
        'errors.E_CONFIGURE_CONFIG_INVALID',
        { errors: result.errors.join('; ') },
        { hint: 'Fix the errors above, or delete arbiter.json and re-run `arbiter init`.' },
      )
    }
    const changedConfig = JSON.stringify(raw) !== JSON.stringify(result.config)
    if (!changedConfig) return { updated, changedConfig, drainWithheld: null }
    await saveConfig(targetDir, result.config)
    return {
      updated,
      changedConfig,
      drainWithheld: syncDrainMaxParallel(targetDir, result.config),
    }
  } finally {
    await lock.release()
  }
}

export async function runConfigure(options: ConfigureOptions): Promise<void> {
  const preset = resolvePreset(options)
  if (options.sets.length === 0 && preset === undefined) {
    if (options.json) {
      jsonOutput('configure', 'error', {}, ['--set is required (non-interactive usage)'])
      process.exit(1)
      return
    }
    process.stderr.write(`${t('cli.configure.usage_hint')}\n`)
    process.exit(2)
  }

  const targetDir = resolve(options.dir ?? process.cwd())
  const configPath = join(targetDir, 'arbiter.json')
  if (!existsSync(configPath)) {
    if (options.json) {
      jsonOutput('configure', 'error', {}, ['No arbiter.json found. Run `arbiter init` first.'])
      process.exit(1)
      return
    }
    throw ArbiterError.fromKey(
      'E_CONFIG_NOT_FOUND',
      'errors.E_CONFIG_NOT_FOUND',
      {},
      {
        hint: 'Run `arbiter init` to initialize governance in this directory.',
        docUrl: 'https://arbiter.dev/reference/cli#init',
      },
    )
  }

  const mutation = await mutateConfig(targetDir, configPath, options.sets, preset)

  const drainWarning = mutation.drainWithheld
    ? t('cli.configure.drain_sync_withheld', {
        path: relative(targetDir, mutation.drainWithheld.drainPath),
        cap: mutation.drainWithheld.cap,
      })
    : null

  if (!mutation.changedConfig) {
    if (options.json) jsonOutput('configure', 'ok', { updated: [] })
    else process.stdout.write(`${t('cli.configure.no_changes')}\n`)
    return
  }

  if (options.json) {
    const reported =
      preset !== undefined ? [`preset=${preset}`, ...mutation.updated] : mutation.updated
    jsonOutput(
      'configure',
      'ok',
      { updated: reported },
      undefined,
      drainWarning ? { warnings: [drainWarning] } : undefined,
    )
    return
  }
  const reported =
    preset !== undefined ? [`preset=${preset}`, ...mutation.updated] : mutation.updated
  process.stdout.write(`${t('cli.configure.updated', { keys: reported.join(', ') })}\n`)
  if (drainWarning) process.stderr.write(`${drainWarning}\n`)
}
