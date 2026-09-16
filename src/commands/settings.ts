// SPDX-License-Identifier: Apache-2.0
// #1121: `arbiter configure show` — discovery view of every settable arbiter.json path
// with its current value, grouped by category. Editing is delegated to
// `arbiter configure` (interactive on TTY, or --set). The SETTINGS_CATALOG is the
// single source of truth that check-settings-coverage.mjs reconciles against
// configure.ts ALLOWED_PATHS — drift is a build failure.

import { join, resolve } from 'node:path'
import { loadConfig } from '../utils/config.js'
import { jsonOutput } from '../utils/json-output.js'
import { readUnifiedState } from './task-state.js'
import { parseValue } from './configure.js'
import { envOverrideKeyForPath, screamingSnakeToCamel } from '../config/env-overrides.js'
import { ARBITER_ENV_FLAGS } from '../config/env-registry.js'
import type { EnvFlag } from '../config/env-registry.js'
import { readFileTranslated } from '../utils/fs.js'
import { parseBooleanEnv } from '../utils/env.js'
import { DEFAULT_TRAIN_LIMITS } from './ship-train.js'
import { DEFAULT_REVIEW_MAX_ROUNDS } from './ship-review.js'
import { DEFAULT_CROSS_MODEL_REVIEW } from '../config/schema.js'
import type { ArbiterConfigV2 } from '../config/schema.js'
import { resolveMaxParallelWorktrees } from '../config/collaboration-mode-defaults.js'

type SettingClassification = 'editable' | 'derived' | 'mandatory' | 'not-applicable' | 'internal'
type SettingCost = 'none' | 'low' | 'medium' | 'high' | 'unmeasured'
type SettingConsent = 'none' | 'github' | 'diff-egress'

interface SettingApplicability {
  applicable: boolean
  reason: string | null
}

interface SettingDefinition {
  /** Dotted path as accepted by `arbiter configure --set path=value`. */
  path: string
  /** Human label shown in the discovery listing. */
  label: string
  classification?: SettingClassification
  effect?: string
  cost?: SettingCost
  consent?: SettingConsent
  applicability?: (config: unknown) => SettingApplicability
  defaultValue?: unknown
  defaultValueFor?: (config: unknown) => unknown
  environment?: boolean
  environmentFlag?: EnvFlag
}

interface SettingField extends SettingDefinition {
  classification: SettingClassification
  effect: string
  cost: SettingCost
  consent: SettingConsent
  applicability: (config: unknown) => SettingApplicability
}

interface SettingGroup {
  group: string
  fields: SettingField[]
}

interface SettingDefinitionGroup {
  group: string
  fields: SettingDefinition[]
}

const ALWAYS_APPLICABLE = (): SettingApplicability => ({ applicable: true, reason: null })
const NO_RUNTIME_CONSUMER = (): SettingApplicability => ({
  applicable: false,
  reason: 'No operational runtime consumer',
})

function resolveMaxParallelDefault(config: unknown): number {
  const project = config as {
    automation?: ArbiterConfigV2['automation']
    collaborationMode?: ArbiterConfigV2['collaborationMode']
    features?: Pick<ArbiterConfigV2['features'], 'soloDevMode'>
  }
  return resolveMaxParallelWorktrees({
    automation: project.automation,
    collaborationMode: project.collaborationMode,
    enableSoloDevMode: project.features?.soloDevMode,
  })
}

/**
 * Catalog of every settable path, grouped for discovery. MUST stay in lockstep
 * with ALLOWED_PATHS in configure.ts (enforced by check-settings-coverage.mjs).
 */
const SETTINGS_DEFINITIONS: SettingDefinitionGroup[] = [
  {
    group: 'Collaboration',
    fields: [
      { path: 'collaborationMode', label: 'Collaboration mode' },
      { path: 'solo.mergeMode', label: 'Solo merge mode' },
      { path: 'branchingStrategy', label: 'Branching strategy' },
    ],
  },
  {
    group: 'Governance',
    fields: [
      { path: 'governanceLevel', label: 'Governance level' },
      {
        path: 'permitGitHub',
        label: 'Permit GitHub integration',
        consent: 'github',
      },
    ],
  },
  {
    group: 'Tools',
    fields: [{ path: 'tools', label: 'AI tools' }],
  },
  {
    group: 'Project shape',
    fields: [
      { path: 'projectName', label: 'Project name' },
      { path: 'language', label: 'Primary language' },
      { path: 'packageManager', label: 'Package manager' },
      { path: 'archetype', label: 'Archetype' },
      { path: 'architectureStyle', label: 'Architecture style' },
      { path: 'contractType', label: 'Contract type' },
      { path: 'isMultiTenant', label: 'Multi-tenant' },
      { path: 'hasDatabase', label: 'Has database' },
      { path: 'databaseEngine', label: 'Database engine' },
      { path: 'hasPublicApi', label: 'Has public API' },
      { path: 'acceptBetaTools', label: 'Allow beta tool integrations' },
      { path: 'decomposition.backend', label: 'Task decomposition backend' },
    ],
  },
  {
    group: 'Features',
    fields: [
      { path: 'features.debtGates', label: 'Debt gates' },
      { path: 'features.suppressions', label: 'Suppressions' },
      { path: 'features.securityScanning', label: 'Security scanning' },
      { path: 'features.mutationTesting', label: 'Mutation testing', defaultValue: true },
      { path: 'features.contractTesting', label: 'Contract testing', defaultValue: true },
      { path: 'features.evidenceHarness', label: 'Evidence harness', defaultValue: true },
      { path: 'features.acceptanceAnchor', label: 'Acceptance-criteria anchor gate (INV-138)' },
      { path: 'features.soloDevMode', label: 'Solo dev mode (deprecated)' },
      // #1887-A: activation path for 3 previously-unreachable opt-in generators.
      { path: 'features.codeownersNotify', label: 'CODEOWNERS post-merge email notify (L2+)' },
      { path: 'features.taxonomy25d', label: '26-dimension compliance test taxonomy' },
      { path: 'features.perfTesting', label: 'k6 performance testing ecosystem' },
      { path: 'features.selfValidationHarness', label: 'Self-validation harness' },
      { path: 'features.auditToolchain', label: 'Toolchain audit' },
      { path: 'features.fiveLaneCi', label: 'Collapsed five-lane CI', cost: 'high' },
      { path: 'features.mcpFallback', label: 'MCP fallback' },
      { path: 'features.noSkippedTests', label: 'Reject skipped tests' },
      // #1887 (Finding-A residual): activation path for the 5 compliance
      // doc-pack flags previously reachable only via --preset industrial-grade.
      { path: 'features.riskRegister', label: 'Risk register doc' },
      { path: 'features.operationsHandbook', label: 'Operations handbook doc' },
      { path: 'features.iso27001Mapping', label: 'ISO 27001 control mapping' },
      { path: 'features.nis2Mapping', label: 'NIS2 control mapping' },
      { path: 'features.gdprMapping', label: 'GDPR control mapping' },
    ],
  },
  {
    group: 'Automation',
    fields: [
      // #1261: ship-autonomy axis (ADR-093 §4). Absent = L0 (ask each ship step);
      // legacy configs without the block stay valid. No `arbiter init` flag by
      // design — set here, via a recipe, or per-run with `arbiter ship --autonomy`.
      {
        path: 'automation.autonomy',
        label: 'Ship autonomy level (absent = L0)',
        defaultValue: 'L0',
      },
      // #1306 (ADR-094 §Decision.4): orchestration prefs derived per collaboration
      // mode / governance level at init.
      // #2333: maxParallelWorktrees is PERSISTENT-ONLY — no per-run `--set`, no
      // resolver floor. It is a persistent wave cap consumed by doctor/wizard
      // coherence and rendered /drain surfaces; absent ⇒ collaboration-mode default.
      {
        path: 'automation.maxParallelWorktrees',
        label: 'Max parallel wave worktrees',
        defaultValueFor: resolveMaxParallelDefault,
      },
      // defaultGateLevel keeps its resolver floor (absent ⇒ L1 at every read site).
      {
        path: 'automation.defaultGateLevel',
        label: 'Default gate level (L1|L2)',
        defaultValue: 'L1',
      },
      {
        path: 'ship.train.maxChain',
        label: 'Maximum issues per delivery train',
        defaultValue: DEFAULT_TRAIN_LIMITS.maxChain,
      },
      {
        path: 'ship.train.maxAgeMinutes',
        label: 'Maximum delivery-train age (minutes)',
        defaultValue: DEFAULT_TRAIN_LIMITS.maxAgeMinutes,
      },
      {
        path: 'ship.review.maxRounds',
        label: 'Maximum review rounds',
        defaultValue: DEFAULT_REVIEW_MAX_ROUNDS,
      },
    ],
  },
  {
    group: 'Runtime',
    fields: [
      { path: 'runnerProfile', label: 'Heavy-check runner cadence', defaultValue: 'fleet' },
      { path: 'channel', label: 'Release channel' },
      { path: 'evidenceRetention', label: 'Evidence retention policy', cost: 'low' },
      { path: 'thresholdProfile', label: 'Threshold scaling policy' },
      { path: 'strictnessTier', label: 'Strictness tier' },
      { path: 'industryOverlay', label: 'Industry policy overlay', cost: 'medium' },
      { path: 'basePackage', label: 'JVM base package' },
      { path: 'deployTarget', label: 'Deployment target', cost: 'high' },
      { path: 'invariantTiers', label: 'Active invariant tiers' },
      { path: 'worktree', label: 'Worktree materialization policy', cost: 'low' },
      {
        path: 'plugins',
        label: 'Installed Arbiter plugins',
        classification: 'internal',
        effect: 'Managed and availability-checked by arbiter configure plugin add/list',
        cost: 'unmeasured',
      },
      {
        path: 'companions',
        label: 'Companion skill policy',
        classification: 'internal',
        effect: 'Resolved from installed companion skills and reported by arbiter status health',
        cost: 'unmeasured',
      },
      { path: 'lanes', label: 'Project lanes' },
      { path: 'taskTiers', label: 'Task-size planning and review policy' },
      { path: 'taxonomy.domainDims', label: 'Project test-taxonomy dimensions' },
      { path: 'observability.provider', label: 'Observability provider', cost: 'medium' },
      { path: 'auth.provider', label: 'Authentication provider', cost: 'medium' },
      { path: 'auth.tenantIsolation', label: 'Authentication tenant isolation' },
      { path: 'frontend.framework', label: 'Frontend framework' },
      { path: 'frontend.stateManager', label: 'Frontend state manager' },
      { path: 'frontend.validationLib', label: 'Frontend validation library' },
      { path: 'governance.invariants_catalog', label: 'Invariant catalog scope' },
      { path: 'governance.constraintScan', label: 'Constraint scan policy' },
      { path: 'governance.ssotGuardPatterns', label: 'Additional protected SSOT paths' },
      { path: 'governance.projectInvariants', label: 'Project-owned invariants' },
      { path: 'governance.liveSsot', label: 'Live SSOT surfaces' },
      {
        path: 'conformanceThresholds',
        label: 'Conformance scoring policy',
        classification: 'not-applicable',
        effect: 'Schema-retained compatibility data without an operational consumer',
        applicability: NO_RUNTIME_CONSUMER,
      },
      { path: 'smokeJourneys.requiredJourneys', label: 'Required product smoke journeys' },
      { path: 'e2ePolicy.escalation.strikes', label: 'E2E escalation ladder' },
      { path: 'e2ePolicy.escalation.maxStrikes', label: 'E2E hard-stop threshold' },
    ],
  },
  {
    group: 'Unavailable or managed state',
    fields: [
      {
        path: 'version',
        label: 'Human-readable config version',
        classification: 'derived',
        effect: 'Written by config migration',
        cost: 'none',
      },
      {
        path: '$schemaVersion',
        label: 'Config migration version',
        classification: 'derived',
        effect: 'Written by config migration routing',
        cost: 'none',
      },
      {
        path: 'graceEndsAt',
        label: 'Governance upgrade grace deadline',
        classification: 'derived',
        effect: 'Managed by arbiter configure level',
        cost: 'none',
      },
      {
        path: 'graceFromLevel',
        label: 'Governance upgrade source level',
        classification: 'derived',
        effect: 'Managed by arbiter configure level',
        cost: 'none',
      },
      {
        path: 'kit.measure',
        label: 'Legacy kit measurement state',
        classification: 'internal',
        effect: 'Migration-compatible internal state',
        cost: 'none',
      },
      {
        path: 'useGitHub',
        label: 'Legacy GitHub permission alias',
        classification: 'internal',
        effect: 'Migrated to permitGitHub',
        cost: 'none',
        consent: 'github',
      },
      ...[
        'contextPack.adrMappings',
        'smokeJourneys.minJourneys',
        'observability.metrics',
        'observability.logs',
        'observability.traces',
        'observability.alerts',
        'auth.protocols',
        'auth.themeSync',
        'decomposition.markdown.dir',
        'decomposition.github.owner',
        'decomposition.github.repo',
      ].map((path) => ({
        path,
        label: path,
        classification: 'not-applicable' as const,
        effect: 'Declared shape without an operational runtime consumer',
        cost: 'none' as const,
        applicability: NO_RUNTIME_CONSUMER,
      })),
    ],
  },
  {
    group: 'Cross-model review',
    fields: [
      {
        path: 'crossModelReview.enabled',
        label: 'Cross-model review enabled',
        defaultValue: DEFAULT_CROSS_MODEL_REVIEW.enabled,
      },
      {
        path: 'crossModelReview.diffEgressConsent',
        label: 'Diff egress consent',
        consent: 'diff-egress',
      },
      { path: 'crossModelReview.providers', label: 'Review providers' },
      { path: 'crossModelReview.slots.codeReview', label: 'Code-review slots' },
      { path: 'crossModelReview.slots.redTeamReview', label: 'Red-team-review slots' },
      { path: 'crossModelReview.timeoutMs', label: 'Review timeout (ms)' },
      { path: 'crossModelReview.onUnavailable', label: 'Unavailable-provider policy' },
    ],
  },
  {
    group: 'Thresholds',
    fields: [
      { path: 'thresholds.lineCoverage', label: 'Line coverage %' },
      { path: 'thresholds.branchCoverage', label: 'Branch coverage %' },
      { path: 'thresholds.mutationScore', label: 'Mutation score %' },
      { path: 'thresholds.cyclomaticComplexity', label: 'Cyclomatic complexity' },
      { path: 'thresholds.methodLength', label: 'Method length' },
      { path: 'thresholds.maxParams', label: 'Max parameters' },
    ],
  },
]

const ENVIRONMENT_SETTINGS: SettingDefinitionGroup = {
  group: 'Per-process environment',
  fields: ARBITER_ENV_FLAGS.map((flag) => ({
    path: flag.name,
    label: flag.name,
    classification: flag.classification === 'runtime' ? 'not-applicable' : 'internal',
    effect: flag.purpose,
    cost: 'unmeasured',
    consent:
      flag.name === 'ARBITER_GITHUB'
        ? 'github'
        : flag.name === 'ARBITER_CROSS_MODEL_REVIEW'
          ? 'diff-egress'
          : 'none',
    applicability: flag.classification === 'reserved' ? NO_RUNTIME_CONSUMER : ALWAYS_APPLICABLE,
    defaultValue: flag.default,
    environment: true,
    environmentFlag: flag,
  })),
}

/**
 * The single product catalog. Definitions stay terse above; product metadata is
 * completed here so a new row cannot silently omit classification or disclosure.
 */
export const SETTINGS_CATALOG: SettingGroup[] = [...SETTINGS_DEFINITIONS, ENVIRONMENT_SETTINGS].map(
  (group) => ({
    group: group.group,
    fields: group.fields.map((field) => ({
      ...field,
      classification: field.classification ?? 'editable',
      effect: field.effect ?? field.label,
      cost: field.cost ?? 'unmeasured',
      consent: field.consent ?? 'none',
      applicability: field.applicability ?? ALWAYS_APPLICABLE,
    })),
  }),
)

/** Every path the settings catalog surfaces (used by the coverage gate + tests). */
export const SETTINGS_PATHS: ReadonlySet<string> = new Set(
  SETTINGS_CATALOG.flatMap((g) => g.fields)
    .filter((field) => field.classification === 'editable')
    .map((field) => field.path),
)

/** Resolve a dotted path against a loaded config object. */
function resolveSettingValue(config: unknown, path: string): unknown {
  let cursor: unknown = config
  for (const segment of path.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

const SETTINGS_BY_PATH = new Map(
  SETTINGS_CATALOG.flatMap((group) => group.fields).map((field) => [field.path, field]),
)

function resolveSettingDefault(field: SettingField, config: unknown): unknown {
  return field.defaultValueFor?.(config) ?? field.defaultValue
}

/** Canonical effective value used by every read-only configuration view. */
export function resolveCatalogSettingValue(config: unknown, path: string): unknown {
  const field = SETTINGS_BY_PATH.get(path)
  if (field === undefined) throw new Error(`Unknown settings catalog path: ${path}`)
  return resolveSettingValue(config, path) ?? resolveSettingDefault(field, config) ?? null
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(unset)'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(none)'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  // Objects and null → JSON (never relies on default toString). Config values
  // are JSON-derived, so this branch only sees objects/null in practice.
  return JSON.stringify(value)
}

type SettingSource = 'session' | 'env' | 'project' | 'default'

interface SettingState {
  declared: unknown
  effective: unknown
  source: SettingSource
  applicability: SettingApplicability
}

function rawProjectConfig(targetDir: string): unknown {
  return JSON.parse(readFileTranslated(join(targetDir, 'arbiter.json'), 'utf8')) as unknown
}

function settingState(
  field: SettingField,
  raw: unknown,
  effectiveConfig: unknown,
  overrides: Record<string, string>,
): SettingState {
  if (field.environment === true) return environmentSettingState(field, effectiveConfig)
  const declared = resolveSettingValue(raw, field.path)
  const loadedValue = resolveSettingValue(effectiveConfig, field.path)
  const sessionValue = overrides[field.path]
  if (sessionValue !== undefined) {
    return {
      declared: declared ?? null,
      effective: parseValue(field.path, sessionValue),
      source: 'session',
      applicability: field.applicability(effectiveConfig),
    }
  }
  const fallback = resolveSettingDefault(field, effectiveConfig)
  const effective = loadedValue ?? fallback ?? null
  const source: SettingSource = envOverrideKeyForPath(field.path, process.env)
    ? 'env'
    : declared !== undefined
      ? 'project'
      : 'default'
  return {
    declared: declared ?? null,
    effective,
    source,
    applicability: field.applicability(effectiveConfig),
  }
}

function parseEnvironmentValue(flag: EnvFlag, raw: string): unknown {
  if (flag.type === 'boolean') return parseBooleanEnv(raw)
  if (flag.type === 'number') {
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : undefined
  }
  if (flag.type === 'enum') return flag.enumValues?.includes(raw) === true ? raw : undefined
  return raw
}

function parsePrefixEnvironment(
  field: SettingField,
  matches: Array<[string, string]>,
  effectiveConfig: unknown,
): unknown {
  const group = field.path === 'ARBITER_FEATURE__' ? 'features' : 'thresholds'
  return Object.fromEntries(
    matches.flatMap(([key]) => {
      const path = `${group}.${screamingSnakeToCamel(key.slice(field.path.length))}`
      if (envOverrideKeyForPath(path, process.env) !== key) return []
      const effective = resolveSettingValue(effectiveConfig, path)
      return effective === undefined ? [] : [[key, effective]]
    }),
  )
}

function declaredEnvironmentValue(
  field: SettingField,
  matches: Array<[string, string]>,
  prefix: boolean,
): unknown {
  if (matches.length === 0) return null
  if (field.classification === 'internal') return '(set)'
  if (matches.length === 1 && !prefix) return matches[0]?.[1]
  return matches.map(([key]) => key)
}

function parsedEnvironmentValue(
  field: SettingField,
  flag: EnvFlag,
  matches: Array<[string, string]>,
  effectiveConfig: unknown,
): unknown {
  if (field.path.endsWith('_')) return parsePrefixEnvironment(field, matches, effectiveConfig)
  const raw = matches[0]?.[1]
  return raw === undefined ? undefined : parseEnvironmentValue(flag, raw)
}

function environmentSettingState(field: SettingField, effectiveConfig: unknown): SettingState {
  const flag = field.environmentFlag
  if (flag === undefined) throw new Error(`Missing environment metadata for ${field.path}`)
  const prefix = field.path.endsWith('_')
  const matches = Object.entries(process.env).filter(
    ([key, value]) =>
      value !== undefined && (prefix ? key.startsWith(field.path) : key === field.path),
  )
  const definedMatches = matches.filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  )
  const declared = declaredEnvironmentValue(field, definedMatches, prefix)
  const parsed = parsedEnvironmentValue(field, flag, definedMatches, effectiveConfig)
  const hasEffective = prefix
    ? Object.keys(parsed as Record<string, unknown>).length > 0
    : parsed !== undefined
  return {
    declared,
    effective:
      field.classification === 'internal' && declared !== null
        ? '(set)'
        : hasEffective
          ? parsed
          : (field.defaultValue ?? null),
    source: hasEffective ? 'env' : 'default',
    applicability: field.applicability({}),
  }
}

interface SettingsOptions {
  dir?: string
  json?: boolean
}

function settingsOutput(raw: unknown, config: unknown, overrides: Record<string, string>) {
  return SETTINGS_CATALOG.map((group) => ({
    group: group.group,
    fields: group.fields.map((field) => ({
      path: field.path,
      label: field.label,
      classification: field.classification,
      effect: field.effect,
      cost: field.cost,
      consent: field.consent,
      ...settingState(field, raw, config, overrides),
    })),
  }))
}

function printSettings(groups: ReturnType<typeof settingsOutput>): void {
  process.stdout.write('\narbiter configure show — current configuration\n')
  for (const group of groups) {
    process.stdout.write(`\n${group.group}\n`)
    for (const field of group.fields) {
      process.stdout.write(
        `  ${field.path.padEnd(34)} ${formatValue(field.effective)} ` +
          `(declared ${formatValue(field.declared)}; ${field.source}; ${field.applicability.applicable ? 'applicable' : `n/a: ${field.applicability.reason ?? 'unspecified'}`})\n`,
      )
    }
  }
  process.stdout.write(
    '\nEdit with `arbiter configure` (interactive) or `arbiter configure --set <path>=<value>`.\n',
  )
}

/** Print the grouped discovery listing of all settable paths + current values. */
export function runSettings(opts: SettingsOptions = {}): void {
  const dir = resolve(opts.dir ?? process.cwd())
  const config = loadConfig(dir)

  if (config == null) {
    process.stderr.write('arbiter: no arbiter.json found. Run `arbiter init` first.\n')
    process.exit(1)
  }

  const raw = rawProjectConfig(dir)
  const overrides = readUnifiedState(dir)?.overrides ?? {}
  const groups = settingsOutput(raw, config, overrides)
  if (opts.json) {
    jsonOutput('configure show', 'ok', { groups })
    return
  }
  printSettings(groups)
}
