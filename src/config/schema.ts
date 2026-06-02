// SPDX-License-Identifier: Apache-2.0
import type {
  AiTool,
  Archetype,
  ArchitectureStyle,
  AuthConfig,
  BranchingStrategy,
  CollaborationMode,
  ContractType,
  EvidenceRetentionConfig,
  FrontendConfig,
  GovernanceLevel,
  InvariantTier,
  Lane,
  Language,
  ObservabilityConfig,
  PlanDepth,
  ProjectPreset,
  SoloMergeMode,
  StrictnessTier,
  TaskTierConfig,
  TaskTiers,
  ThresholdProfile,
  ThresholdsV2,
  WorktreeConfig,
} from '../wizard/types.js'

export type { ThresholdsV2, TaskTiers, TaskTierConfig, PlanDepth }

export interface FeatureFlags {
  contractTesting: boolean
  mutationTesting: boolean
  securityScanning: boolean
  evidenceHarness: boolean
  selfValidationHarness?: boolean
  debtGates: boolean
  suppressions: boolean
  soloDevMode?: boolean
}

export type DecompositionBackendId = 'github' | 'markdown'

export const DEFAULT_TASK_TIERS: TaskTiers = {
  XS: { planDepth: 'minimal', reviewAgentCount: 3 },
  S: { planDepth: 'brief', reviewAgentCount: 3 },
  Standard: { planDepth: 'full', reviewAgentCount: 4 },
}

export interface DecompositionConfig {
  backend: DecompositionBackendId
  markdown?: { dir: string }
  github?: { owner: string; repo: string }
}

/**
 * File-pattern to ADR mapping for CONTEXT_PACK generation (#254).
 * Pattern supports `*` (non-slash wildcard) and `**` (any-path wildcard).
 */
export interface ContextPackAdrMapping {
  pattern: string
  adr: string
}

/**
 * Configuration for the CONTEXT_PACK generator (#254).
 * Stored under `contextPack` in `arbiter.json`.
 */
export interface ContextPackConfig {
  /** File-pattern to ADR mappings. Used by `arbiter context-pack` to annotate @source: citations. */
  adrMappings?: ContextPackAdrMapping[]
}

/**
 * Integer migration-routing version (#605 / R1.K7).
 *
 * `version` (string) remains the human-facing semver-ish marker
 * ("0.1", "0.2", ...). `$schemaVersion` is the machine routing key the
 * migration registry consults — bumped only on a config-shape change.
 *
 * Loading a config with `$schemaVersion > CURRENT_CONFIG_SCHEMA_VERSION`
 * is a hard error (do not silently load); see `loadConfig`.
 */
export const CURRENT_CONFIG_SCHEMA_VERSION = 4

export interface ArbiterConfigV2 {
  version: string
  $schemaVersion?: number
  tools: AiTool[]
  governanceLevel: GovernanceLevel
  useGitHub?: boolean
  permitGitHub?: boolean
  decomposition?: DecompositionConfig
  features: FeatureFlags
  thresholds: ThresholdsV2
  /** Detected project language. Persisted so `arbiter update` can detect language migrations and re-run language-gated generators. */
  language?: Language
  archetype?: Archetype
  architectureStyle?: ArchitectureStyle
  isMultiTenant?: boolean
  hasDatabase?: boolean
  hasPublicApi?: boolean
  acceptBetaTools?: boolean
  evidenceRetention?: EvidenceRetentionConfig
  thresholdProfile?: ThresholdProfile
  strictnessTier?: StrictnessTier
  graceEndsAt?: string
  graceFromLevel?: GovernanceLevel
  contractType?: ContractType
  basePackage?: string
  invariantTiers?: InvariantTier[]
  worktree?: WorktreeConfig
  plugins?: string[]
  lanes?: Lane[]
  taskTiers?: TaskTiers
  /** CONTEXT_PACK generator configuration (#254). */
  contextPack?: ContextPackConfig
  /** Observability provider configuration. Absent = no observability files generated. */
  observability?: ObservabilityConfig
  /** Auth provider configuration. Absent = no auth setup files generated. */
  auth?: AuthConfig
  /** Frontend framework + tooling configuration. Absent = no framework-specific governance text. */
  frontend?: FrontendConfig
  /** Active project preset for audit/drift detection. Absent = no preset applied. */
  preset?: ProjectPreset
  /** Release channel preference. Controls `arbiter doctor` reporting + downgrade warnings. Default: latest. */
  channel?: 'latest' | 'beta' | 'canary'
  /** Governance policy overrides. Absent = default behaviour. */
  governance?: GovernanceConfig
  /** KIT install state. Populated by `arbiter kit install` (not under --dry-run). */
  kit?: {
    measure: Record<string, { status: 'present' | 'partial' | 'missing'; evidence: string[] }>
  }
  /** ADR-051: collaboration-mode axis. Absent = inferred from features.soloDevMode or defaults to 'peer-review'. */
  collaborationMode?: CollaborationMode
  /**
   * ADR-051: branching strategy. When absent, derived from collaborationMode defaults table.
   * Persisted only when set via `arbiter configure --set branchingStrategy=…`.
   */
  branchingStrategy?: BranchingStrategy
  /**
   * ADR-051: trunk-solo merge method override.
   * 'direct' = push to trunk, no PR. 'pr-ff' = gh pr + ff-only merge.
   * Persisted only when set via `arbiter configure --set solo.mergeMode=…`.
   */
  solo?: { mergeMode: SoloMergeMode }
}

export interface GovernanceConfig {
  /**
   * Invariant catalog scope.
   * 'core' (default): INV-01..INV-61 only.
   * 'extended': also includes opt-in extended set (INV-62..INV-71).
   */
  invariants_catalog?: 'core' | 'extended'
}

export type ValidateResult = { ok: true; config: ArbiterConfigV2 } | { ok: false; errors: string[] }

export const DEFAULT_THRESHOLDS: Record<GovernanceLevel, ThresholdsV2> = {
  L1: {
    lineCoverage: 60,
    branchCoverage: 50,
    mutationScore: 70,
    cyclomaticComplexity: 20,
    methodLength: 100,
    maxParams: 8,
  },
  L2: {
    lineCoverage: 80,
    branchCoverage: 70,
    mutationScore: 80,
    cyclomaticComplexity: 15,
    methodLength: 65,
    maxParams: 7,
  },
  L3: {
    lineCoverage: 85,
    branchCoverage: 80,
    mutationScore: 85,
    cyclomaticComplexity: 10,
    methodLength: 40,
    maxParams: 5,
  },
  L4: {
    lineCoverage: 85,
    branchCoverage: 80,
    mutationScore: 85,
    cyclomaticComplexity: 10,
    methodLength: 40,
    maxParams: 5,
  },
}

const GOVERNANCE_LEVELS: ReadonlySet<string> = new Set(['L1', 'L2', 'L3', 'L4'])
export const VALID_COLLABORATION_MODES: ReadonlySet<string> = new Set([
  'trunk-solo',
  'peer-review',
  'gated-review',
])
export const VALID_SOLO_MERGE_MODES: ReadonlySet<string> = new Set(['direct', 'pr-ff'])
export const VALID_BRANCHING_STRATEGIES: ReadonlySet<string> = new Set([
  'trunk-direct',
  'github-flow',
  'github-flow-with-develop',
])
const AI_TOOLS: ReadonlySet<string> = new Set([
  'claude',
  'codex',
  'cursor',
  'copilot',
  'gemini',
  'windsurf',
  'aider',
])

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function validateThresholds(raw: unknown, errors: string[]): boolean {
  if (!isRecord(raw)) {
    errors.push('thresholds must be an object')
    return false
  }
  let ok = true
  const coverage = ['lineCoverage', 'branchCoverage', 'mutationScore'] as const
  for (const key of coverage) {
    const v = raw[key]
    if (typeof v !== 'number' || v <= 0 || v > 100) {
      errors.push(`thresholds.${key} must be a number between 1 and 100`)
      ok = false
    }
  }
  const positive = ['cyclomaticComplexity', 'methodLength', 'maxParams'] as const
  for (const key of positive) {
    const v = raw[key]
    if (typeof v !== 'number' || v <= 0) {
      errors.push(`thresholds.${key} must be a positive number`)
      ok = false
    }
  }
  return ok
}

function validateFeatures(raw: unknown, errors: string[]): boolean {
  if (!isRecord(raw)) {
    errors.push('features must be an object')
    return false
  }
  let ok = true
  const flags = [
    'contractTesting',
    'mutationTesting',
    'securityScanning',
    'evidenceHarness',
    'debtGates',
    'suppressions',
  ] as const
  for (const key of flags) {
    if (typeof raw[key] !== 'boolean') {
      errors.push(`features.${key} must be a boolean`)
      ok = false
    }
  }
  // selfValidationHarness is optional for forward-compat; validate only if present
  if ('selfValidationHarness' in raw && typeof raw['selfValidationHarness'] !== 'boolean') {
    errors.push('features.selfValidationHarness must be a boolean')
    ok = false
  }
  // soloDevMode is optional; validate only if present
  if ('soloDevMode' in raw && typeof raw['soloDevMode'] !== 'boolean') {
    errors.push('features.soloDevMode must be a boolean')
    ok = false
  }
  return ok
}

/**
 * ADR-051 (#1119): validate collaboration-mode axis fields when present in the raw config.
 * Extracted from validateConfig to keep its complexity below the 15-statement threshold.
 */
function validateCollaborationAxes(raw: Record<string, unknown>, errors: string[]): void {
  if ('collaborationMode' in raw && raw['collaborationMode'] !== undefined) {
    const cm = raw['collaborationMode'] as string
    if (!VALID_COLLABORATION_MODES.has(cm)) {
      errors.push(
        `collaborationMode must be one of trunk-solo, peer-review, gated-review — got ${cm}`,
      )
    }
  }
  if ('branchingStrategy' in raw && raw['branchingStrategy'] !== undefined) {
    const bs = raw['branchingStrategy'] as string
    if (!VALID_BRANCHING_STRATEGIES.has(bs)) {
      errors.push(
        `branchingStrategy must be one of trunk-direct, github-flow, github-flow-with-develop — got ${bs}`,
      )
    }
  }
  if (isRecord(raw['solo']) && raw['solo']['mergeMode'] !== undefined) {
    const mm = raw['solo']['mergeMode'] as string
    if (!VALID_SOLO_MERGE_MODES.has(mm)) {
      errors.push(`solo.mergeMode must be one of direct, pr-ff — got ${mm}`)
    }
  }
}

function autoFillThresholds(raw: Record<string, unknown>, level: unknown): void {
  if (
    raw['thresholds'] === undefined &&
    typeof level === 'string' &&
    GOVERNANCE_LEVELS.has(level)
  ) {
    raw['thresholds'] = { ...DEFAULT_THRESHOLDS[level as GovernanceLevel] }
  }
}

export function validateConfig(raw: unknown): ValidateResult {
  if (!isRecord(raw)) {
    return { ok: false, errors: ['config must be a non-null object'] }
  }

  const errors: string[] = []

  if (typeof raw['version'] !== 'string') {
    errors.push('version must be a string')
  }

  // #503 — basePackage is optional, but if present must be a string.
  // Without this guard, non-string values (numbers, null) propagate to
  // archunit/mutation EJS templates and produce invalid Java packages.
  if ('basePackage' in raw && raw['basePackage'] !== undefined) {
    if (typeof raw['basePackage'] !== 'string') {
      errors.push('basePackage must be a string')
    }
  }

  const rawLevel = raw['governanceLevel']
  const level = typeof rawLevel === 'string' ? rawLevel.toUpperCase() : rawLevel
  if (typeof rawLevel === 'string') raw['governanceLevel'] = level
  if (typeof level !== 'string' || !GOVERNANCE_LEVELS.has(level)) {
    errors.push(`governanceLevel must be one of L1, L2, L3, L4 — got ${String(rawLevel)}`)
  }

  if (
    !Array.isArray(raw['tools']) ||
    (raw['tools'] as unknown[]).some((t) => !AI_TOOLS.has(t as string))
  ) {
    errors.push('tools must be an array of valid AI tools')
  }

  const hasUseGitHub = typeof raw['useGitHub'] === 'boolean'
  const hasPermitGitHub = typeof raw['permitGitHub'] === 'boolean'
  if (!hasUseGitHub && !hasPermitGitHub) {
    errors.push('useGitHub or permitGitHub must be a boolean')
  }

  // ADR-051 (#1119): validate collaboration-mode axis fields when present.
  validateCollaborationAxes(raw, errors)

  autoFillThresholds(raw, level)

  validateFeatures(raw['features'], errors)
  validateThresholds(raw['thresholds'], errors)
  validateDecomposition(raw['decomposition'], errors)
  validateFrontend(raw['frontend'], errors)
  validateLanes(raw['lanes'], errors)
  validateTaskTiers(raw['taskTiers'], errors)
  validateContextPack(raw['contextPack'], errors)
  validateChannel(raw['channel'], errors)
  validateGovernance(raw['governance'], errors)
  validateKit(raw['kit'], errors)

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const config = { ...raw } as unknown as ArbiterConfigV2
  return { ok: true, config }
}

const VALID_FRONTEND_FRAMEWORKS: ReadonlySet<string> = new Set(['vue', 'react', 'svelte'])
const FRONTEND_IDENT_RE = /^[@a-zA-Z0-9][a-zA-Z0-9@/._-]{0,59}$/

function validateFrontend(raw: unknown, errors: string[]): void {
  if (raw == null) return
  if (!isRecord(raw)) {
    errors.push('frontend must be an object')
    return
  }
  if (raw['framework'] != null) {
    if (typeof raw['framework'] !== 'string') {
      errors.push('frontend.framework must be a string')
    } else if (!VALID_FRONTEND_FRAMEWORKS.has(raw['framework'])) {
      errors.push(`frontend.framework must be one of vue, react, svelte — got ${raw['framework']}`)
    }
  }
  for (const k of ['stateManager', 'validationLib'] as const) {
    if (raw[k] != null) {
      if (typeof raw[k] !== 'string') {
        errors.push(`frontend.${k} must be a string`)
      } else if (!FRONTEND_IDENT_RE.test(raw[k])) {
        errors.push(`frontend.${k} must match [a-zA-Z0-9-], max 40 chars — got ${raw[k]}`)
      }
    }
  }
}

const DECOMPOSITION_BACKENDS = new Set(['github', 'markdown'])
const VALID_LANES: ReadonlySet<string> = new Set(['frontend', 'backend', 'docs'])

function validateLanes(raw: unknown, errors: string[]): void {
  if (raw === undefined || raw === null) return
  if (!Array.isArray(raw)) {
    errors.push('lanes must be an array')
    return
  }
  for (const v of raw) {
    if (!VALID_LANES.has(v as string)) {
      errors.push(`lanes contains invalid value: ${String(v)}`)
    }
  }
}

function validateContextPack(raw: unknown, errors: string[]): void {
  if (raw === undefined || raw === null) return
  if (!isRecord(raw)) {
    errors.push('contextPack must be an object')
    return
  }
  const mappings = raw['adrMappings']
  if (mappings === undefined || mappings === null) return
  if (!Array.isArray(mappings)) {
    errors.push('contextPack.adrMappings must be an array')
    return
  }
  for (let i = 0; i < mappings.length; i++) {
    const m: unknown = mappings[i]
    if (!isRecord(m)) {
      errors.push(`contextPack.adrMappings[${i}] must be an object`)
      continue
    }
    if (typeof m['pattern'] !== 'string' || m['pattern'].length === 0) {
      errors.push(`contextPack.adrMappings[${i}].pattern must be a non-empty string`)
    }
    if (typeof m['adr'] !== 'string' || m['adr'].length === 0) {
      errors.push(`contextPack.adrMappings[${i}].adr must be a non-empty string`)
    }
  }
}

const VALID_INVARIANTS_CATALOG_VALUES = new Set(['core', 'extended'])

function validateGovernance(raw: unknown, errors: string[]): void {
  if (raw === undefined || raw === null) return
  if (!isRecord(raw)) {
    errors.push('governance must be an object')
    return
  }
  const catalog = raw['invariants_catalog']
  if (catalog !== undefined && !VALID_INVARIANTS_CATALOG_VALUES.has(catalog as string)) {
    errors.push(
      `governance.invariants_catalog must be 'core' or 'extended' — got ${typeof catalog === 'string' ? catalog : JSON.stringify(catalog)}`,
    )
  }
}

const VALID_KIT_STATUSES = new Set(['present', 'partial', 'missing'])

function validateKit(raw: unknown, errors: string[]): void {
  if (raw === undefined || raw === null) return
  if (!isRecord(raw)) {
    errors.push('kit must be an object')
    return
  }
  const measure = raw['measure']
  if (measure === undefined || measure === null) return
  if (!isRecord(measure)) {
    errors.push('kit.measure must be an object')
    return
  }
  for (const [dimId, entry] of Object.entries(measure)) {
    if (!isRecord(entry)) {
      errors.push(`kit.measure.${dimId} must be an object`)
      continue
    }
    if (!VALID_KIT_STATUSES.has(entry['status'] as string)) {
      errors.push(`kit.measure.${dimId}.status must be present, partial, or missing`)
    }
    if (
      !Array.isArray(entry['evidence']) ||
      (entry['evidence'] as unknown[]).some((e) => typeof e !== 'string')
    ) {
      errors.push(`kit.measure.${dimId}.evidence must be an array of strings`)
    }
    const known = new Set(['status', 'evidence'])
    const extra = Object.keys(entry).filter((k) => !known.has(k))
    if (extra.length > 0) {
      errors.push(`kit.measure.${dimId} has unknown keys: ${extra.join(', ')}`)
    }
  }
}

const VALID_PLAN_DEPTHS: ReadonlySet<string> = new Set(['minimal', 'brief', 'full'])

function validateOneTier(tierName: 'XS' | 'S' | 'Standard', raw: unknown, errors: string[]): void {
  if (!isRecord(raw)) {
    errors.push(`taskTiers.${tierName} must be an object`)
    return
  }
  const planDepth = raw['planDepth']
  if (typeof planDepth !== 'string' || !VALID_PLAN_DEPTHS.has(planDepth)) {
    errors.push(`taskTiers.${tierName}.planDepth must be one of minimal, brief, full`)
  }
  const count = raw['reviewAgentCount']
  if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) {
    errors.push(`taskTiers.${tierName}.reviewAgentCount must be a positive integer`)
  }
}

function validateTaskTiers(raw: unknown, errors: string[]): void {
  if (raw === undefined || raw === null) return
  if (!isRecord(raw)) {
    errors.push('taskTiers must be an object')
    return
  }
  const required: ('XS' | 'S' | 'Standard')[] = ['XS', 'S', 'Standard']
  for (const tier of required) {
    if (!(tier in raw)) {
      errors.push(`taskTiers.${tier} is required`)
      continue
    }
    validateOneTier(tier, raw[tier], errors)
  }
}

function validateDecomposition(raw: unknown, errors: string[]): void {
  if (raw === undefined || raw === null) return
  if (!isRecord(raw)) {
    errors.push('decomposition must be an object')
    return
  }
  const backend = raw['backend']
  if (backend !== undefined && !DECOMPOSITION_BACKENDS.has(backend as string)) {
    errors.push(
      `decomposition.backend must be "github" or "markdown" — got ${typeof backend === 'string' ? backend : JSON.stringify(backend)}`,
    )
  }
}

const VALID_CHANNELS: ReadonlySet<string> = new Set(['latest', 'beta', 'canary'])

function validateChannel(raw: unknown, errors: string[]): void {
  if (raw === undefined || raw === null) return
  if (typeof raw !== 'string' || !VALID_CHANNELS.has(raw)) {
    errors.push(`channel must be one of latest, beta, canary — got ${JSON.stringify(raw)}`)
  }
}
