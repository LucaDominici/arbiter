// SPDX-License-Identifier: Apache-2.0
import type {
  AiTool,
  Archetype,
  ArchitectureStyle,
  AuthConfig,
  AuthProvider,
  AutonomyLevel,
  BranchingStrategy,
  CollaborationMode,
  ConformanceThresholds,
  ContractType,
  CrossModelReviewConfig,
  CrossModelReviewProvider,
  CrossModelReviewUnavailablePolicy,
  DeployTarget,
  EvidenceRetentionConfig,
  FrontendConfig,
  GovernanceLevel,
  InvariantTier,
  Lane,
  Language,
  ObservabilityConfig,
  ObservabilityProvider,
  ProjectPreset,
  SoloMergeMode,
  StrictnessTier,
  TaskTiers,
  ThresholdProfile,
  ThresholdsV2,
  WorktreeConfig,
} from '../wizard/types.js'
import type { BrownfieldClass } from '../kit/thresholds.js'
import type { Invariant } from '../invariants/types.js'

export interface FeatureFlags {
  contractTesting: boolean
  mutationTesting: boolean
  securityScanning: boolean
  evidenceHarness: boolean
  /** INV-138: acceptance-criteria anchor gate (scripts/check-acceptance.mjs). Opt-in — absent ⇒ false. */
  acceptanceAnchor?: boolean
  selfValidationHarness?: boolean
  /** #1835: opt-in toolchain/workflow-inventory audit (scripts/audit-toolchain.mjs). */
  auditToolchain?: boolean
  /** #1835 (Task B, #1825): opt-in collapsed 5-lane CI doctrine (see enableFiveLaneCi). */
  fiveLaneCi?: boolean
  debtGates: boolean
  suppressions: boolean
  soloDevMode?: boolean
  /** #1887-A: persistence of enableMcpFallback (opt-in — omitted/absent ⇒ false). */
  mcpFallback?: boolean
  /** #1887-A: persistence of enableNoSkippedTests (opt-out — absent ⇒ true). */
  noSkippedTests?: boolean
  /**
   * #1887-A: compliance doc-pack, set only by applyPreset('industrial-grade').
   * Without persistence a preset-initialized project silently dropped these
   * generators on the next `arbiter update`/`diff`. All opt-in — absent ⇒ false.
   */
  riskRegister?: boolean
  operationsHandbook?: boolean
  iso27001Mapping?: boolean
  nis2Mapping?: boolean
  gdprMapping?: boolean
  /**
   * #1887-A: 3 more generators built + gated on the ProjectConfig field but with
   * no public activation path at all — same round-trip-drop class. Opt-in,
   * absent ⇒ false.
   */
  codeownersNotify?: boolean
  taxonomy25d?: boolean
  perfTesting?: boolean
}

export type DecompositionBackendId = 'github' | 'markdown'

export const DEFAULT_TASK_TIERS: TaskTiers = {
  XS: { planDepth: 'minimal', reviewAgentCount: 1 },
  S: { planDepth: 'brief', reviewAgentCount: 1 },
  Standard: { planDepth: 'full', reviewAgentCount: 2 },
}

export const DEFAULT_CROSS_MODEL_REVIEW: CrossModelReviewConfig = {
  enabled: false,
  diffEgressConsent: false,
  providers: ['codex'],
  slots: { codeReview: 1, redTeamReview: 0 },
  timeoutMs: 300_000,
  onUnavailable: 'degrade',
}

interface DecompositionConfig {
  backend: DecompositionBackendId
  markdown?: { dir: string }
  github?: { owner: string; repo: string }
}

/**
 * File-pattern to ADR mapping for CONTEXT_PACK generation (#254).
 * Pattern supports `*` (non-slash wildcard) and `**` (any-path wildcard).
 */
interface ContextPackAdrMapping {
  pattern: string
  adr: string
}

/**
 * Configuration for the CONTEXT_PACK generator (#254).
 * Stored under `contextPack` in `arbiter.json`.
 */
// #1291 (ADR-093 §4) — minimal automation block; #1261 wires it end-to-end
// (wizard → persist → settings → configure). The AutonomyLevel union lives in
// wizard/types.ts (cycle-safe home); re-exported here for existing consumers.
export type { AutonomyLevel }
export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = ['L0', 'L1', 'L2', 'L3']

/**
 * #1306 (ADR-094 §Decision.4) — the gate level `arbiter verify` runs by default.
 * Deliberately ONLY L1/L2 (the runnable gate levels): a defaultGateLevel is a
 * per-run gate selector, not a governance tier, so L3/L4 are not valid values.
 */
export type GateLevel = 'L1' | 'L2'
export const VALID_GATE_LEVELS: readonly GateLevel[] = ['L1', 'L2']

export interface AutomationConfig {
  autonomy: AutonomyLevel
  /**
   * #1306 (ADR-094 §Decision.4) — max wave worktrees that may run concurrently.
   * Positive integer. Absent ⇒ derived per collaboration mode (1 for trunk-solo,
   * which never uses worktrees; >1 for peer/gated). trunk-solo + >1 is incoherent.
   */
  maxParallelWorktrees?: number
  /** #1306 (ADR-094 §Decision.4) — default gate level for verification. Absent ⇒ derived from governance level. */
  defaultGateLevel?: GateLevel
}

/**
 * #2043 (AC-2043.2): the per-project smoke-journey acceptance floor. Declared in
 * arbiter.json so the generated check-smoke-journeys.mjs gate enforces a genuine
 * login/CRUD/authz floor per project — not just the journeys a team happened to
 * declare. Absent ⇒ the gate falls back to the login/CRUD/authz trio.
 */
export interface SmokeJourneyPolicy {
  /** Journey ids that must ALL be declared in smoke-journeys.json. Default: ['auth','crud','authz']. */
  requiredJourneys?: string[]
  /** Per-project floor: minimum number of DECLARED journeys (2..4). Default: 3. */
  minJourneys?: number
}

/**
 * #2043 (AC-2043.4/5): the e2e escalation policy — the configurable
 * consecutive-failure ladder replacing the hardcoded 2-strike rule. Absent ⇒ the
 * ship tick prompt and the ledger gate (check-e2e-escalation.mjs) both fall back
 * to the pre-#2043 2-strike default. Present ⇒ ship tick prompt renders off
 * `escalation.maxStrikes`; the ledger gate consumes `escalation.strikes`
 * per-rung when present (#2248), else falls back to the scalar `maxStrikes`
 * check (legacy).
 */
export interface E2eEscalationPolicy {
  escalation: {
    /**
     * Consecutive-failure ladder — each entry widens the response (e.g. [2, 3, 5]:
     * widen scope at 2, force the full suite at 3, hard-stop at 5). Validated
     * (an array of numbers) and consumed per-rung by check-e2e-escalation.mjs
     * (#2248, AC-2248.2): the highest rung the ledger's trailing consecutive-
     * REGRESSION count crosses drives distinct exit messaging (widen /
     * force-full-suite / hard-stop-to-needs-human).
     */
    strikes: number[]
    /**
     * Required once `escalation` is declared. Drives the ship tick prompt's
     * within-run strike count unconditionally; drives check-e2e-escalation.mjs's
     * escalate/no-escalate decision only when `strikes` above is absent/invalid
     * (the pre-#2248 scalar path, kept for backward compatibility). No
     * config-layer default: when the whole `e2ePolicy` key is ABSENT, both
     * check-e2e-escalation.mjs and TICK_PROMPT.md.ejs fall back to 2 (the
     * pre-#2043 hardcoded 2-strike rule) — see the interface doc above.
     */
    maxStrikes: number
  }
}

/**
 * #2401 — `/ship` ceremony bounds. The train (one worktree/branch/gate/PR carrying N issues)
 * is the DEFAULT unit of ceremony, so how far it may grow is a per-project decision rather
 * than a constant. Absent ⇒ {@link DEFAULT_TRAIN_LIMITS} (maxChain 10, maxAgeMinutes 480).
 */
export interface ShipConfig {
  /** Sealed-train bounds, resolved by `resolveTrainLimits` (src/commands/ship-train.ts). */
  train?: {
    /** Total ids on the branch (primary + chained) at which the next append is refused. Absent ⇒ 10. */
    maxChain?: number
    /** Age of the open train, in minutes, past which the next append is refused. Absent ⇒ 480. */
    maxAgeMinutes?: number
  }
  review?: {
    /**
     * Rework rounds a review stage may take before the task stops. Absent ⇒ 2.
     * DECLARED, typed and validated here only — nothing enforces it yet; wiring it into the
     * plan-review / code-review loops is tracked separately. A reader is what turns this from
     * a documented default into a bound, so do not treat its presence as enforcement.
     */
    maxRounds?: number
  }
}

interface ContextPackConfig {
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
 *
 * #1524: kept in lock-step with the migration terminus. The chain ends at
 * `migrateV3ToV4`, which stamps `$schemaVersion: 4`, so a freshly-migrated
 * config is a `4`. There is no `v4-to-v5` migration, so advertising `5` here
 * desynced the loader's ceiling from the highest version this build can emit.
 * The `migration-terminus` invariant test guards this equality.
 */
export const CURRENT_CONFIG_SCHEMA_VERSION = 4

/**
 * #257/#1524: domain-specific test-taxonomy configuration. Its `domainDims[]`
 * flow into the TEST_TAXONOMY template. Declared here (the config SSOT) so the
 * generator can read it through the type system instead of an untyped cast.
 */
export interface TaxonomyConfig {
  /** Project-specific taxonomy dimensions appended to the archetype defaults. */
  domainDims?: string[]
}

export interface ArbiterConfigV2 {
  version: string
  $schemaVersion?: number
  /**
   * #1978: durable project name, resolved once at `init` time via
   * {@link resolveProjectName} (stored name → package.json → git remote → cwd
   * basename) and persisted here so `arbiter update`/`diff` never re-derive it
   * from the cwd basename — which breaks every worktree-based invocation
   * (a worktree dir like `1978-fix-cwd` would otherwise become the project
   * name). Absent on configs written before this field existed; callers fall
   * back through the same precedence chain in that case.
   */
  projectName?: string
  tools: AiTool[]
  governanceLevel: GovernanceLevel
  useGitHub?: boolean
  permitGitHub?: boolean
  decomposition?: DecompositionConfig
  features: FeatureFlags
  thresholds: ThresholdsV2
  /**
   * Project language. Persisted so it is authoritative over raw filesystem detection
   * (#1343 `resolveLanguage`): a Go-primary repo with a frontend-lane package.json keeps
   * `go`. It is re-detected only on a genuine on-disk migration — when this stored
   * language's build-file signal is gone — so `arbiter update` still picks up language
   * migrations and re-runs language-gated generators.
   */
  language?: Language
  /** JavaScript package manager used by generated package-script gate checks. */
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun'
  archetype?: Archetype
  architectureStyle?: ArchitectureStyle
  isMultiTenant?: boolean
  /**
   * #1317: legacy/derived database flag. Kept for back-compat — derived from
   * {@link databaseEngine} (`hasDatabase = databaseEngine != null && databaseEngine !== 'none'`).
   * Persisting both is fine; the axis derivation in detectors/axis.ts keeps them in sync.
   */
  hasDatabase?: boolean
  /**
   * #1317: database engine axis. Source of truth for integration-testing scaffolding
   * (sqlite ⇒ containerless TestMain; none ⇒ no DB test; postgresql/mysql ⇒ testcontainers).
   * Absent ⇒ derived from {@link hasDatabase} (legacy `hasDatabase:true` ⇒ 'postgresql').
   */
  databaseEngine?: 'postgresql' | 'mysql' | 'mongodb' | 'sqlite' | 'other' | 'none'
  hasPublicApi?: boolean
  acceptBetaTools?: boolean
  evidenceRetention?: EvidenceRetentionConfig
  thresholdProfile?: ThresholdProfile
  strictnessTier?: StrictnessTier
  graceEndsAt?: string
  graceFromLevel?: GovernanceLevel
  contractType?: ContractType
  /**
   * #1254: industry compliance overlay axis. Persisted so `arbiter doctor`
   * can flag incoherent (overlay × governanceLevel) cells and `arbiter update`
   * re-emits the overlay artefacts. Absent = 'none'.
   */
  industryOverlay?:
    'pharma' | 'sox' | 'gdpr' | 'generic' | 'iso27001' | 'iso9001' | 'regulated' | 'none'
  basePackage?: string
  /**
   * #1616: deploy target axis. Consumed by the github (04-deploy-test/10-deploy-prod
   * workflows) and infra (azure-container-app) generators. Persisted so `arbiter
   * update`/`diff` re-emit deploy workflows + infra instead of silently coercing to
   * 'none' on every backend-web-db project's round-trip.
   */
  deployTarget?: DeployTarget
  invariantTiers?: InvariantTier[]
  worktree?: WorktreeConfig
  plugins?: string[]
  /**
   * #1730 — per-companion overrides for /ship companion-plugin activation, keyed by bare skill
   * name or full skillId (e.g. "ponytail"). Absent ⇒ any installed companion auto-activates in
   * its policy-default mode on product repos. `enabled:false` disables without uninstalling;
   * `mode` forces lite|full. Never activates on arbiter-self regardless of this setting.
   */
  companions?: Record<string, { enabled?: boolean; mode?: 'lite' | 'full' }>
  lanes?: Lane[]
  taskTiers?: TaskTiers
  /**
   * #257/#1524: domain-specific test-taxonomy dimensions. Consumed by the
   * TEST_TAXONOMY generator (`generateTestTaxonomy`) and surfaced in
   * docs/TEST_TAXONOMY.md. Declared on the SSOT type so a key typo or rename is
   * a compile error rather than a silent fall-through to `[]`.
   */
  taxonomy?: TaxonomyConfig
  /** CONTEXT_PACK generator configuration (#254). */
  contextPack?: ContextPackConfig
  /** #1291 — ship autonomy gating (ADR-093 §4). Absent ⇒ L0 (ask each step). */
  automation?: AutomationConfig
  /** #2356 — opt-in external review and explicit code-egress consent. */
  crossModelReview?: CrossModelReviewConfig
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
  /**
   * #1394/#1623: conformance scoring override. When present (and valid), it is merged
   * over the level-default + brownfield overlay so a project can pin its own tier-1
   * members / family weights / gold gate. validateConfig validates it; runConformance
   * reads + applies it. Absent ⇒ the governance×brownfield default drives the bar.
   */
  conformanceThresholds?: ConformanceThresholds
  /**
   * #1693 (ADR-101): runner profile axis, orthogonal to collaborationMode/pipelineStyle.
   * 'fleet' (default) = current behavior: fuzz + soak-e2e heavy jobs run at nightly
   *   cadence, hard-gated by nightly-required.
   * 'solo' = fuzz + soak-e2e move to weekly cadence instead (single self-hosted
   *   runner), preserving the same hard-gate + issue-filing semantics at weekly
   *   cadence. Absent field treated as 'fleet'.
   */
  runnerProfile?: 'solo' | 'fleet'
  /** #2043 (AC-2043.2): per-project smoke-journey acceptance floor. Absent ⇒ {@link DEFAULT_SMOKE_JOURNEYS}. */
  smokeJourneys?: SmokeJourneyPolicy
  /** #2043 (AC-2043.4/5): configurable e2e escalation ladder. Absent ⇒ {@link DEFAULT_E2E_ESCALATION}. */
  e2ePolicy?: E2eEscalationPolicy
  /** #2401: `/ship` ceremony bounds — train size/age and the review round cap. */
  ship?: ShipConfig
}

interface GovernanceConfig {
  /**
   * Invariant catalog scope.
   * 'core' (default): INV-01..INV-61 only.
   * 'extended': also includes opt-in extended set (INV-62..INV-71).
   */
  invariants_catalog?: 'core' | 'extended'
  /**
   * INV-115 constraint-scan gate toggle (#2037).
   * 'on' (default): fail-closed when scripts/constraint-map.json is missing.
   * 'off': explicit, visible opt-out — the gate SKIPs instead of running.
   */
  constraintScan?: 'on' | 'off'
  /**
   * #2045: repo-relative substrings guarded by pre-edit-ssot-guard.mjs, read at hook
   * runtime (not baked into the hook), ADDED to the hook's own DEFAULT_SSOT_PATTERNS
   * (AGENTS.md, .claude/CLAUDE.md, .agents/CODEX.md, docs/METHOD/, docs/SYSTEM/DECISIONS,
   * docs/SYSTEM/CANON.md, docs/ADR/). Additive only — cannot remove a default-guarded
   * path, so a config typo or an empty list never silently weakens the guard.
   */
  ssotGuardPatterns?: string[]
  /**
   * #2035: project-declared invariants (PROJ-NN namespace). The project is the
   * author of its own catalog additions — merged with the built-in catalog at
   * getFilteredInvariants. Ids MUST be PROJ-NN (never INV-NN — the built-in
   * namespace is reserved); duplicates and retired entries are rejected.
   */
  projectInvariants?: Invariant[]
  /**
   * #2044 (AC-2044.5/6): live-SSOT surfaces — the declared-live matrix/ledger
   * files that a code change MUST update in the SAME commit. check-drift
   * (--live-ssot) binds the commit to the declared surfaces; the obligation is
   * LIMITED to these surfaces (not every commit).
   */
  liveSsot?: {
    surfaces: { path: string; kind: 'matrix' | 'ledger'; keys?: string[] }[]
  }
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
    // #1511 — gold-standard branch bar (>=0.88). Branch coverage is a stronger
    // decision-path signal than lines; the top tiers no longer sit ~8pp below it.
    branchCoverage: 88,
    mutationScore: 85,
    cyclomaticComplexity: 10,
    methodLength: 40,
    maxParams: 5,
  },
  L4: {
    lineCoverage: 85,
    // #1511 — gold-standard branch bar (>=0.88), matching L3.
    branchCoverage: 88,
    mutationScore: 85,
    cyclomaticComplexity: 10,
    methodLength: 40,
    maxParams: 5,
  },
}

// ── Conformance thresholds SSOT (#1394/C2) ───────────────────────────────────

// #1658: must list EVERY id whose probe carries `tier: 1` in dimensions.ts. The score
// engine now derives the must-pass gate from the structural `tier` field, so this list
// is an additive override — but it must not drift below the structural set or it
// misrepresents what the gate enforces. The 4 trailing ids (coverage/invariants/commit/
// finding hygiene) were the orphaned tier-1 dims that previously sat in a dead zone.
const TIER1_MEMBERS_DEFAULT = [
  'D-TEST-LEVELS',
  'D-GATE-GREEN',
  'D-DONE-EVIDENCE',
  'D-NO-OVERCLAIM',
  'D-LIVE-E2E',
  'D-FE-RENDER-GATE',
  'D-DOMAIN-API',
  'D-COVERAGE-THRESHOLDS',
  'D-INVARIANTS-ENFORCED',
  'D-COMMIT-HYGIENE',
  'DISC-finding-hygiene',
]

const DEFAULT_FAMILY_WEIGHTS: ConformanceThresholds['familyWeights'] = {
  discipline: 0.15,
  'reality-contact': 0.35,
  'docs-convention': 0.2,
  'code-quality-gold': 0.3,
}

const DEFAULT_CONFORMANCE_THRESHOLDS: Record<GovernanceLevel, ConformanceThresholds> = {
  L1: {
    tier1Members: TIER1_MEMBERS_DEFAULT,
    familyWeights: DEFAULT_FAMILY_WEIGHTS,
    goldTier2Gate: 0.85,
  },
  L2: {
    tier1Members: TIER1_MEMBERS_DEFAULT,
    familyWeights: DEFAULT_FAMILY_WEIGHTS,
    goldTier2Gate: 0.88,
  },
  L3: {
    tier1Members: TIER1_MEMBERS_DEFAULT,
    familyWeights: DEFAULT_FAMILY_WEIGHTS,
    goldTier2Gate: 0.9,
  },
  L4: {
    tier1Members: TIER1_MEMBERS_DEFAULT,
    familyWeights: DEFAULT_FAMILY_WEIGHTS,
    goldTier2Gate: 0.92,
  },
}

const BROWNFIELD_CONFORMANCE_OVERLAYS: Record<BrownfieldClass, Partial<ConformanceThresholds>> = {
  gold: { goldTier2Gate: 0.9 },
  light: { goldTier2Gate: 0.8 },
  medium: { goldTier2Gate: 0.75 },
  heavy: { goldTier2Gate: 0.7 },
}

export function validateConformanceThresholds(raw: unknown): string[] {
  const errors: string[] = []
  if (typeof raw !== 'object' || raw === null) {
    errors.push('conformanceThresholds must be an object')
    return errors
  }
  const t = raw as Record<string, unknown>
  if (!Array.isArray(t['tier1Members'])) {
    errors.push('conformanceThresholds.tier1Members must be an array')
  }
  if (typeof t['familyWeights'] !== 'object' || t['familyWeights'] === null) {
    errors.push('conformanceThresholds.familyWeights must be an object')
  }
  if (typeof t['goldTier2Gate'] !== 'number') {
    errors.push('conformanceThresholds.goldTier2Gate must be a number')
  }
  return errors
}

export function autoFillConformanceThresholds(
  level: GovernanceLevel,
  cls?: BrownfieldClass,
): ConformanceThresholds {
  const base = { ...DEFAULT_CONFORMANCE_THRESHOLDS[level] }
  if (cls !== undefined) {
    const overlay = BROWNFIELD_CONFORMANCE_OVERLAYS[cls]
    return { ...base, ...overlay }
  }
  return base
}

export const GOVERNANCE_LEVELS: ReadonlySet<string> = new Set(['L1', 'L2', 'L3', 'L4'])
// #1254 — valid industryOverlay values (mirrors ProjectConfig.industryOverlay).
export const INDUSTRY_OVERLAYS: ReadonlySet<string> = new Set([
  'pharma',
  'sox',
  'gdpr',
  'generic',
  'iso27001',
  'iso9001',
  'regulated',
  'none',
])
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
/**
 * Canonical AI-tool allow-list — the single source of truth for tool validation.
 * #1594: exported so the v1→v2 migration filter imports it instead of keeping a
 * stale hand-copy that silently strips newer tools (gemini/windsurf/aider).
 */
export const AI_TOOLS: ReadonlySet<string> = new Set([
  'claude',
  'codex',
  'cursor',
  'copilot',
  'gemini',
  'windsurf',
  'aider',
])

/**
 * #1589/#1579: known-value sets for the constrained-union optionals so
 * validateConfig rejects a typo'd value at the trust boundary instead of letting
 * it fall through to the weaker default. Each `Record<Union, true>` forces the
 * set to stay exhaustive and in-sync with its union at compile time — a member
 * added to (or removed from) the union breaks the build until the set matches.
 */
type DatabaseEngineUnion = NonNullable<ArbiterConfigV2['databaseEngine']>
const DATABASE_ENGINE_VALUES: Record<DatabaseEngineUnion, true> = {
  postgresql: true,
  mysql: true,
  mongodb: true,
  sqlite: true,
  other: true,
  none: true,
}
const STRICTNESS_TIER_VALUES: Record<StrictnessTier, true> = { practical: true, pedantic: true }
// #1693: runnerProfile axis runtime mirror (ADR-101).
type RunnerProfileUnion = NonNullable<ArbiterConfigV2['runnerProfile']>
const RUNNER_PROFILE_VALUES: Record<RunnerProfileUnion, true> = { solo: true, fleet: true }
type PackageManagerUnion = NonNullable<ArbiterConfigV2['packageManager']>
const PACKAGE_MANAGER_VALUES: Record<PackageManagerUnion, true> = {
  npm: true,
  pnpm: true,
  yarn: true,
  bun: true,
}
const THRESHOLD_PROFILE_VALUES: Record<ThresholdProfile, true> = { scaled: true, fixed: true }
const CONTRACT_TYPE_VALUES: Record<ContractType, true> = {
  'rest-owned': true,
  'rest-public': true,
  graphql: true,
  grpc: true,
  'message-queue': true,
  none: true,
}
// #1632: the two NESTED provider unions. validateConfig validated the four scalar
// unions above but never these — a typo'd auth.provider/observability.provider passed
// the trust boundary (hand-edit, CLI cast, or round-trip) and the generator emitted a
// content-less setup doc. The exhaustive Record forces each set to track its union.
const AUTH_PROVIDER_VALUES: Record<AuthProvider, true> = {
  none: true,
  'app-level-ts': true,
  authelia: true,
  authentik: true,
  'ory-stack': true,
  zitadel: true,
  keycloak: true,
  'saas-clerk': true,
  'saas-auth0': true,
  'saas-supabase-auth': true,
  'saas-cognito': true,
}
const OBSERVABILITY_PROVIDER_VALUES: Record<ObservabilityProvider, true> = {
  none: true,
  'stdout-minimal': true,
  'victoria-vector-quickwit': true,
  signoz: true,
  openobserve: true,
  'prom-grafana-loki-jaeger': true,
  'saas-sentry': true,
  'saas-datadog': true,
  'saas-axiom': true,
  'saas-betterstack': true,
}
// #<T0>: exported (in addition to being used internally by validateOptionalEnums)
// so the never-brick coercion pass (sanitizeCoercibleFields, below) can classify
// a value against the exact same allow-list the strict validator uses — one
// source of truth, no risk of the two drifting apart.
export const DATABASE_ENGINES: ReadonlySet<string> = new Set(Object.keys(DATABASE_ENGINE_VALUES))
export const STRICTNESS_TIERS: ReadonlySet<string> = new Set(Object.keys(STRICTNESS_TIER_VALUES))
export const RUNNER_PROFILES: ReadonlySet<string> = new Set(Object.keys(RUNNER_PROFILE_VALUES))
export const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(Object.keys(PACKAGE_MANAGER_VALUES))
export const THRESHOLD_PROFILES: ReadonlySet<string> = new Set(
  Object.keys(THRESHOLD_PROFILE_VALUES),
)
export const CONTRACT_TYPES: ReadonlySet<string> = new Set(Object.keys(CONTRACT_TYPE_VALUES))
// #1676: exported so the `arbiter init` CLI cast site (src/cli.ts) can reject an
// unknown --auth-provider/--observability-provider value at parse time, instead of
// blind-casting it and emitting a content-less AUTH_SETUP.md/OBSERVABILITY.md once
// before the next validateConfig load catches it.
export const AUTH_PROVIDERS: ReadonlySet<string> = new Set(Object.keys(AUTH_PROVIDER_VALUES))
export const OBSERVABILITY_PROVIDERS: ReadonlySet<string> = new Set(
  Object.keys(OBSERVABILITY_PROVIDER_VALUES),
)

// #1677: deploy-target union runtime mirror. The exhaustive Record forces the set
// to track the DeployTarget union (a new member is a tsc error here until listed).
// Consumed by the `arbiter init --deploy-target` flag validator (src/cli.ts).
const DEPLOY_TARGET_VALUES: Record<DeployTarget, true> = {
  ghcr: true,
  'azure-container-app': true,
  'aws-ecs': true,
  'gcp-cloud-run': true,
  'nas-compose': true,
  none: true,
}
export const DEPLOY_TARGETS: ReadonlySet<string> = new Set(Object.keys(DEPLOY_TARGET_VALUES))

/**
 * #1677: type-narrowing validator for the `--deploy-target` non-interactive flag.
 * Mirrors the `validateProviders` membership-check pattern; rejecting at the CLI cast
 * site (no silent coercion) keeps an unknown value from reaching buildNonInteractiveConfig.
 */
export function isDeployTarget(value: string): value is DeployTarget {
  return DEPLOY_TARGETS.has(value)
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

const THRESHOLD_COVERAGE_KEYS = ['lineCoverage', 'branchCoverage', 'mutationScore'] as const
const THRESHOLD_POSITIVE_KEYS = ['cyclomaticComplexity', 'methodLength', 'maxParams'] as const

/**
 * #1585: single source of truth for threshold range validity — coverage keys are
 * 1..100, the positive keys are > 0. Exported so the env-override layer
 * (env-overrides.ts) reuses the exact same bounds validateThresholds enforces and
 * the two definitions cannot drift. An out-of-range env override is dropped+warned
 * by the override layer instead of flowing through and bricking validateConfig.
 */
export function isThresholdValueInRange(key: string, value: number): boolean {
  if ((THRESHOLD_COVERAGE_KEYS as readonly string[]).includes(key)) {
    return value > 0 && value <= 100
  }
  if ((THRESHOLD_POSITIVE_KEYS as readonly string[]).includes(key)) {
    return value > 0
  }
  return true
}

/**
 * #1530: signals failure purely via the shared `errors[]` out-param, like its ten
 * sibling validators. (Historically returned a `boolean` that every call site
 * discarded — a dead, misleading contract.)
 */
function validateThresholds(raw: unknown, errors: string[]): void {
  if (!isRecord(raw)) {
    errors.push('thresholds must be an object')
    return
  }
  for (const key of THRESHOLD_COVERAGE_KEYS) {
    const v = raw[key]
    if (typeof v !== 'number' || !isThresholdValueInRange(key, v)) {
      errors.push(`thresholds.${key} must be a number between 1 and 100`)
    }
  }
  for (const key of THRESHOLD_POSITIVE_KEYS) {
    const v = raw[key]
    if (typeof v !== 'number' || !isThresholdValueInRange(key, v)) {
      errors.push(`thresholds.${key} must be a positive number`)
    }
  }
}

// Forward-compat optional feature flags: validate ONLY if present (absence is
// valid — the field simply defaults at read-back time). One shared loop keeps
// validateFeatures's cyclomatic complexity flat as flags are added (#1887-A
// added mcpFallback/noSkippedTests/the 5-flag compliance doc-pack on top of
// the pre-existing selfValidationHarness/auditToolchain/fiveLaneCi/soloDevMode).
const OPTIONAL_FEATURE_FLAGS = [
  'selfValidationHarness',
  'auditToolchain',
  'fiveLaneCi',
  'soloDevMode',
  'mcpFallback',
  'noSkippedTests',
  'riskRegister',
  'operationsHandbook',
  'iso27001Mapping',
  'nis2Mapping',
  'gdprMapping',
  'codeownersNotify',
  'taxonomy25d',
  'perfTesting',
  'acceptanceAnchor',
] as const

/** #1530: `: void` like its siblings — failure flows through `errors[]`, not a return. */
function validateFeatures(raw: unknown, errors: string[]): void {
  if (!isRecord(raw)) {
    errors.push('features must be an object')
    return
  }
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
    }
  }
  for (const key of OPTIONAL_FEATURE_FLAGS) {
    if (key in raw && typeof raw[key] !== 'boolean') {
      errors.push(`features.${key} must be a boolean`)
    }
  }
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

/**
 * Validate the optional scalar fields (basePackage, industryOverlay). Extracted
 * from validateConfig to keep its complexity below the 15-statement threshold.
 */
function validateOptionalScalars(raw: Record<string, unknown>, errors: string[]): void {
  // #503 — basePackage is optional, but if present must be a string.
  // Without this guard, non-string values (numbers, null) propagate to
  // archunit/mutation EJS templates and produce invalid Java packages.
  if ('basePackage' in raw && raw['basePackage'] !== undefined) {
    if (typeof raw['basePackage'] !== 'string') {
      errors.push('basePackage must be a string')
    }
  }

  // #1978 — projectName is optional, but if present must be a string. It is
  // the highest-precedence source resolveProjectName consults, so a malformed
  // value must fail fast rather than silently propagate into every generated file.
  if ('projectName' in raw && raw['projectName'] !== undefined) {
    if (typeof raw['projectName'] !== 'string') {
      errors.push('projectName must be a string')
    }
  }

  // #1254 — industryOverlay is optional, but if present must be a known value.
  if ('industryOverlay' in raw && raw['industryOverlay'] !== undefined) {
    const overlay = raw['industryOverlay']
    if (typeof overlay !== 'string' || !INDUSTRY_OVERLAYS.has(overlay)) {
      errors.push(
        `industryOverlay must be one of ${[...INDUSTRY_OVERLAYS].join(', ')} — got ${typeof overlay === 'string' ? overlay : typeof overlay}`,
      )
    }
  }
}

/**
 * #1579/#1589: validate the constrained-union optionals (databaseEngine,
 * strictnessTier, thresholdProfile, contractType). Each governs gate strictness or
 * test scaffolding routing; a typo'd value previously passed validateConfig
 * untouched (final `as unknown` cast) and silently degraded to the weaker default
 * with no diagnostic. Mirrors the industryOverlay / collaborationMode precedent:
 * validate only if present, emit `<field> must be one of … — got <v>` on mismatch.
 */
function validateOptionalEnums(raw: Record<string, unknown>, errors: string[]): void {
  const checks: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
    ['databaseEngine', DATABASE_ENGINES],
    ['strictnessTier', STRICTNESS_TIERS],
    ['thresholdProfile', THRESHOLD_PROFILES],
    ['contractType', CONTRACT_TYPES],
    // #1693: runnerProfile axis (ADR-101).
    ['runnerProfile', RUNNER_PROFILES],
    ['packageManager', PACKAGE_MANAGERS],
  ]
  for (const [field, allowed] of checks) {
    if (field in raw && raw[field] !== undefined) {
      const v = raw[field]
      if (typeof v !== 'string' || !allowed.has(v)) {
        errors.push(
          `${field} must be one of ${[...allowed].join(', ')} — got ${typeof v === 'string' ? v : typeof v}`,
        )
      }
    }
  }
}

/**
 * #1632: validate the two NESTED provider unions (auth.provider,
 * observability.provider). Mirrors validateOptionalEnums for the scalar unions:
 * when the block is present and carries a provider, assert it is a known member —
 * otherwise a typo silently produces a content-less AUTH_SETUP.md / OBSERVABILITY.md.
 */
function validateProviders(raw: Record<string, unknown>, errors: string[]): void {
  const checks: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
    ['auth', AUTH_PROVIDERS],
    ['observability', OBSERVABILITY_PROVIDERS],
  ]
  for (const [field, allowed] of checks) {
    const block = raw[field]
    if (isRecord(block) && block['provider'] !== undefined) {
      const v = block['provider']
      if (typeof v !== 'string' || !allowed.has(v)) {
        errors.push(
          `${field}.provider must be one of ${[...allowed].join(', ')} — got ${typeof v === 'string' ? v : typeof v}`,
        )
      }
    }
  }
}

/**
 * #1730: validate the optional per-companion override map
 * (`companions?: Record<string, { enabled?: boolean; mode?: 'lite' | 'full' }>`).
 * `ultra` — or any other out-of-union string — is rejected HERE so a malformed
 * override can never reach resolveCompanions through loadConfig.
 */
function validateCompanions(raw: Record<string, unknown>, errors: string[]): void {
  const block = raw['companions']
  if (block === undefined) return
  if (!isRecord(block) || Array.isArray(block)) {
    errors.push(
      `companions must be an object map of per-companion overrides — got ${Array.isArray(block) ? 'array' : typeof block}`,
    )
    return
  }
  for (const [name, override] of Object.entries(block)) {
    validateCompanionOverride(name, override, errors)
  }
}

/** One entry of the `companions` map: `{ enabled?: boolean; mode?: 'lite' | 'full' }`. */
function validateCompanionOverride(name: string, override: unknown, errors: string[]): void {
  if (!isRecord(override)) {
    errors.push(`companions.${name} must be an object — got ${typeof override}`)
    return
  }
  if (override['enabled'] !== undefined && typeof override['enabled'] !== 'boolean') {
    errors.push(`companions.${name}.enabled must be a boolean`)
  }
  const mode = override['mode']
  if (mode !== undefined && mode !== 'lite' && mode !== 'full') {
    errors.push(
      `companions.${name}.mode must be one of lite, full — got ${typeof mode === 'string' ? mode : typeof mode}`,
    )
  }
}

export function validateConfig(raw: unknown): ValidateResult {
  if (!isRecord(raw)) {
    return { ok: false, errors: ['config must be a non-null object'] }
  }

  // #1530: validateConfig is a pure validator — normalize on a deep copy so the
  // caller's object (which may be frozen, shared, or cached) is never mutated.
  // The governanceLevel upper-case and threshold auto-fill below write only to
  // `draft`, which becomes the returned config.
  const draft = structuredClone(raw)

  const errors: string[] = []

  if (typeof draft['version'] !== 'string') {
    errors.push('version must be a string')
  }

  validateOptionalScalars(draft, errors)
  validateOptionalEnums(draft, errors)
  validateProviders(draft, errors)
  validateCompanions(draft, errors)

  const rawLevel = draft['governanceLevel']
  const level = typeof rawLevel === 'string' ? rawLevel.toUpperCase() : rawLevel
  if (typeof rawLevel === 'string') draft['governanceLevel'] = level
  if (typeof level !== 'string' || !GOVERNANCE_LEVELS.has(level)) {
    errors.push(`governanceLevel must be one of L1, L2, L3, L4 — got ${String(rawLevel)}`)
  }

  if (
    !Array.isArray(draft['tools']) ||
    (draft['tools'] as unknown[]).some((t) => !AI_TOOLS.has(t as string))
  ) {
    errors.push('tools must be an array of valid AI tools')
  }

  const hasUseGitHub = typeof draft['useGitHub'] === 'boolean'
  const hasPermitGitHub = typeof draft['permitGitHub'] === 'boolean'
  if (!hasUseGitHub && !hasPermitGitHub) {
    errors.push('useGitHub or permitGitHub must be a boolean')
  }

  // ADR-051 (#1119): validate collaboration-mode axis fields when present.
  validateCollaborationAxes(draft, errors)

  autoFillThresholds(draft, level)

  validateFeatures(draft['features'], errors)
  validateThresholds(draft['thresholds'], errors)
  validateDecomposition(draft['decomposition'], errors)
  validateFrontend(draft['frontend'], errors)
  validateLanes(draft['lanes'], errors)
  validateTaskTiers(draft['taskTiers'], errors)
  validateContextPack(draft['contextPack'], errors)
  validateAutomation(draft['automation'], errors)
  validateCrossModelReview(draft['crossModelReview'], errors)
  validateChannel(draft['channel'], errors)
  validateGovernance(draft['governance'], errors)
  validateKit(draft['kit'], errors)
  validateSmokeJourneys(draft['smokeJourneys'], errors)
  validateE2ePolicy(draft['e2ePolicy'], errors)
  validateShip(draft['ship'], errors)

  // #1394 — validate conformanceThresholds when present in config
  if (draft['conformanceThresholds'] !== undefined) {
    const ctErrors = validateConformanceThresholds(draft['conformanceThresholds'])
    errors.push(...ctErrors)
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const config = draft as unknown as ArbiterConfigV2
  return { ok: true, config }
}

/** One field sanitizeCoercibleFields rewrote because its value failed validateConfig. */
export interface CoercedField {
  /** Top-level field name that was coerced (e.g. "contractType"). */
  field: string
  /** The original (invalid) value that was present. */
  from: unknown
  /**
   * The value substituted in its place. `undefined` means the field was
   * dropped entirely — it becomes absent, which validateConfig already
   * treats as "not configured" for every field in the coercible set.
   */
  to: unknown
}

export interface SanitizeResult {
  draft: Record<string, unknown>
  report: CoercedField[]
}

/**
 * Never-brick fallback (T0 — total config migration).
 *
 * `loadConfig` calls this ONLY after a strict `validateConfig()` pass has
 * already failed — a config that validates cleanly never reaches this
 * function, so the happy path is byte-for-byte unchanged.
 *
 * Deliberately narrow: this repairs only the closed set of "axis/identity"
 * fields that steer template/generator SELECTION. It does NOT touch
 * `features`, `thresholds`, `decomposition`, `frontend`, `automation`,
 * `contextPack`, `taskTiers`, `kit`, `companions`, `governance`,
 * `conformanceThresholds` or `channel` — a bad shape in any of those
 * controls gate strictness or CI composition directly, so silently
 * defaulting it could mask a real misconfiguration instead of a stale
 * migration. Those stay FATAL (loadConfig still throws E_CONFIG_INVALID).
 *
 * Coercible set, each with a safe, already-precedented default:
 *   - `contractType`, `databaseEngine`, `strictnessTier`, `thresholdProfile`,
 *     `runnerProfile`, `industryOverlay` — unknown/removed enum value → the
 *     field is dropped (becomes absent/"not configured").
 *   - `lanes` — invalid entries are filtered out; valid entries are kept.
 *   - `governanceLevel` — absent → defaults to `'L2'`. A present but invalid
 *     value is FATAL: this field defines what “green” means, so it must fail
 *     closed like a syntax error rather than silently weakening governance.
 *   - `tools` — unknown entries filtered to the known `AI_TOOLS` set;
 *     falls back to `['claude', 'codex']` if that would empty the array.
 *   - `useGitHub`/`permitGitHub` — neither present as a boolean → defaults
 *     `permitGitHub: false`.
 *
 * Never mutates its input; returns a fresh draft plus a `report` of every
 * field it touched. An empty report means nothing here was coercible — the
 * caller should treat the original validation failure as fatal.
 */
export function sanitizeCoercibleFields(raw: Record<string, unknown>): SanitizeResult {
  const draft = structuredClone(raw)
  const report: CoercedField[] = []

  const dropIfInvalidEnum = (field: string, allowed: ReadonlySet<string>): void => {
    const v = draft[field]
    if (v === undefined) return
    if (typeof v === 'string' && allowed.has(v)) return
    report.push({ field, from: v, to: undefined })
    Reflect.deleteProperty(draft, field)
  }

  dropIfInvalidEnum('contractType', CONTRACT_TYPES)
  dropIfInvalidEnum('databaseEngine', DATABASE_ENGINES)
  dropIfInvalidEnum('strictnessTier', STRICTNESS_TIERS)
  dropIfInvalidEnum('thresholdProfile', THRESHOLD_PROFILES)
  dropIfInvalidEnum('runnerProfile', RUNNER_PROFILES)
  dropIfInvalidEnum('industryOverlay', INDUSTRY_OVERLAYS)

  if (Array.isArray(draft['lanes'])) {
    const original = draft['lanes'] as unknown[]
    const filtered = original.filter((v) => VALID_LANES.has(v as string))
    if (filtered.length !== original.length) {
      report.push({ field: 'lanes', from: original, to: filtered })
      draft['lanes'] = filtered
    }
  }

  const rawLevel = draft['governanceLevel']
  if (rawLevel === undefined) {
    report.push({ field: 'governanceLevel', from: rawLevel, to: 'L2' })
    draft['governanceLevel'] = 'L2'
  }

  const rawTools = draft['tools']
  const toolsInvalid =
    !Array.isArray(rawTools) || (rawTools as unknown[]).some((t) => !AI_TOOLS.has(t as string))
  if (toolsInvalid) {
    const filtered = Array.isArray(rawTools)
      ? (rawTools as unknown[]).filter((t) => AI_TOOLS.has(t as string))
      : []
    const fallback = filtered.length > 0 ? filtered : ['claude', 'codex']
    report.push({ field: 'tools', from: rawTools, to: fallback })
    draft['tools'] = fallback
  }

  const hasUseGitHub = typeof draft['useGitHub'] === 'boolean'
  const hasPermitGitHub = typeof draft['permitGitHub'] === 'boolean'
  if (!hasUseGitHub && !hasPermitGitHub) {
    report.push({ field: 'permitGitHub', from: draft['permitGitHub'], to: false })
    draft['permitGitHub'] = false
  }

  return { draft, report }
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
export const VALID_LANES: ReadonlySet<string> = new Set(['frontend', 'backend', 'docs'])

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

function validateAutomation(raw: unknown, errors: string[]): void {
  if (raw === undefined || raw === null) return
  if (!isRecord(raw)) {
    errors.push('automation must be an object')
    return
  }
  const level = raw['autonomy']
  if (!AUTONOMY_LEVELS.includes(level as AutonomyLevel)) {
    errors.push(`automation.autonomy must be one of ${AUTONOMY_LEVELS.join('|')}`)
  }
  validateAutomationPrefs(raw, errors)
}

/**
 * #1306 — validate the three optional Project-Profile orchestration prefs. They are
 * additive (no $schemaVersion bump): validated only when present, so a legacy config
 * (autonomy alone, or no automation block) stays valid. Extracted from
 * validateAutomation to keep it under the complexity ceiling.
 */
function validateAutomationPrefs(raw: Record<string, unknown>, errors: string[]): void {
  const mpw = raw['maxParallelWorktrees']
  if (mpw !== undefined && (typeof mpw !== 'number' || !Number.isInteger(mpw) || mpw < 1)) {
    errors.push('automation.maxParallelWorktrees must be a positive integer')
  }
  const gate = raw['defaultGateLevel']
  if (gate !== undefined && !VALID_GATE_LEVELS.includes(gate as GateLevel)) {
    errors.push(`automation.defaultGateLevel must be one of ${VALID_GATE_LEVELS.join('|')}`)
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

const CROSS_MODEL_REVIEW_PROVIDERS: ReadonlySet<CrossModelReviewProvider> = new Set(['codex'])
const CROSS_MODEL_REVIEW_POLICIES: ReadonlySet<CrossModelReviewUnavailablePolicy> = new Set([
  'degrade',
  'fail',
])

/** #2356 — validate the optional, consent-bearing external-review block. */
function validateCrossModelReview(raw: unknown, errors: string[]): void {
  if (raw === undefined) return
  if (!isRecord(raw)) {
    errors.push('crossModelReview must be an object')
    return
  }
  validateCrossModelBooleans(raw, errors)
  validateCrossModelProviders(raw, errors)
  validateCrossModelSlots(raw, errors)
  validateCrossModelTimeout(raw, errors)
  validateCrossModelPolicy(raw, errors)
}

function validateCrossModelBooleans(raw: Record<string, unknown>, errors: string[]): void {
  if (typeof raw['enabled'] !== 'boolean') {
    errors.push('crossModelReview.enabled must be a boolean')
  }
  if (typeof raw['diffEgressConsent'] !== 'boolean') {
    errors.push('crossModelReview.diffEgressConsent must be a boolean')
  }
}

function validateCrossModelProviders(raw: Record<string, unknown>, errors: string[]): void {
  const providers = raw['providers']
  if (
    !Array.isArray(providers) ||
    providers.length === 0 ||
    providers.some(
      (provider) => !CROSS_MODEL_REVIEW_PROVIDERS.has(provider as CrossModelReviewProvider),
    )
  ) {
    errors.push('crossModelReview.providers must be a non-empty array containing only codex')
  }
}

function validateCrossModelSlots(raw: Record<string, unknown>, errors: string[]): void {
  const slots = raw['slots']
  if (!isRecord(slots)) {
    errors.push('crossModelReview.slots must be an object')
    return
  }
  const codeReview = slots['codeReview']
  if (codeReview !== 0 && codeReview !== 1) {
    errors.push('crossModelReview.slots.codeReview must be 0 or 1 in v1')
  }
  const redTeamReview = slots['redTeamReview']
  if (redTeamReview !== 0) {
    errors.push('crossModelReview.slots.redTeamReview must be 0 until red-team support ships')
  }
}

function validateCrossModelTimeout(raw: Record<string, unknown>, errors: string[]): void {
  const timeoutMs = raw['timeoutMs']
  if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 1) {
    errors.push('crossModelReview.timeoutMs must be a positive integer')
  }
}

function validateCrossModelPolicy(raw: Record<string, unknown>, errors: string[]): void {
  if (!CROSS_MODEL_REVIEW_POLICIES.has(raw['onUnavailable'] as CrossModelReviewUnavailablePolicy)) {
    errors.push('crossModelReview.onUnavailable must be degrade or fail')
  }
}

const VALID_INVARIANTS_CATALOG_VALUES = new Set(['core', 'extended'])
const VALID_CONSTRAINT_SCAN_VALUES = new Set(['on', 'off'])

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
  const constraintScan = raw['constraintScan']
  if (constraintScan !== undefined && !VALID_CONSTRAINT_SCAN_VALUES.has(constraintScan as string)) {
    errors.push(
      `governance.constraintScan must be 'on' or 'off' — got ${typeof constraintScan === 'string' ? constraintScan : JSON.stringify(constraintScan)}`,
    )
  }
  validateSsotGuardPatterns(raw['ssotGuardPatterns'], errors)
  validateProjectInvariants(raw['projectInvariants'], errors)
  validateLiveSsot(raw['liveSsot'], errors)
}

/** #2044: split out of validateGovernance to keep its cyclomatic complexity under the L2 ratchet. */
function validateLiveSsot(raw: unknown, errors: string[]): void {
  if (raw === undefined || raw === null) return
  if (!isRecord(raw)) {
    errors.push('governance.liveSsot must be an object')
    return
  }
  const surfaces = raw['surfaces']
  if (!Array.isArray(surfaces)) {
    errors.push('governance.liveSsot.surfaces must be an array')
    return
  }
  for (const entry of surfaces) {
    if (!isRecord(entry) || typeof entry['path'] !== 'string') {
      errors.push('governance.liveSsot.surfaces entries must be objects with a string path')
      continue
    }
    const kind = entry['kind']
    if (kind !== 'matrix' && kind !== 'ledger') {
      errors.push(
        `governance.liveSsot.surfaces kind must be 'matrix' or 'ledger' — got ${String(kind)}`,
      )
    }
    const keys = entry['keys']
    if (keys !== undefined && (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string'))) {
      errors.push('governance.liveSsot.surfaces keys must be an array of strings')
    }
  }
}

// #680 mirror: languageDetail must cover every declared language. Split out of
// validateProjectInvariantEntry (#2035) to keep max-depth under the L2 ratchet
// — the nested for-of/if pair no longer stacks on top of the entry loop.
function validateProjectInvariantLanguages(
  id: string,
  entry: Record<string, unknown>,
  errors: string[],
): void {
  const languages = entry['languages']
  if (languages === undefined) return
  if (!Array.isArray(languages) || languages.some((l) => typeof l !== 'string')) {
    errors.push(`governance.projectInvariants ${id} languages must be an array of strings`)
    return
  }
  const languageDetail = entry['languageDetail']
  if (!isRecord(languageDetail)) return
  for (const lang of languages) {
    if (!(lang in languageDetail)) {
      errors.push(
        `governance.projectInvariants ${id} languageDetail must cover every language in languages (missing ${String(lang)})`,
      )
    }
  }
}

/** #2035: split out of validateGovernance to keep its cyclomatic complexity under the L2 ratchet. */
function validateProjectInvariantEntry(entry: unknown, seen: Set<string>, errors: string[]): void {
  if (!isRecord(entry)) {
    errors.push('governance.projectInvariants entries must be objects')
    return
  }
  const id = entry['id']
  if (typeof id !== 'string' || !PROJ_INVARIANT_ID_RE.test(id)) {
    errors.push(
      `governance.projectInvariants id must match /^PROJ-\\d+$/ (the INV-NN namespace is reserved) — got ${String(id)}`,
    )
    return
  }
  if (seen.has(id)) {
    errors.push(`governance.projectInvariants duplicate id: ${id}`)
    return
  }
  seen.add(id)
  if (entry['status'] === 'retired') {
    errors.push(`governance.projectInvariants ${id} must not be retired`)
  }
  if (
    entry['tier'] === undefined ||
    entry['title'] === undefined ||
    entry['description'] === undefined
  ) {
    errors.push(`governance.projectInvariants ${id} requires tier, title, and description`)
  }
  if (typeof entry['alwaysActive'] !== 'boolean') {
    errors.push(`governance.projectInvariants ${id} requires boolean alwaysActive`)
  }
  validateProjectInvariantLanguages(id, entry, errors)
}

/** #2035: split out of validateGovernance to keep its cyclomatic complexity under the L2 ratchet. */
function validateProjectInvariants(raw: unknown, errors: string[]): void {
  if (raw === undefined || raw === null) return
  if (!Array.isArray(raw)) {
    errors.push('governance.projectInvariants must be an array of invariant objects')
    return
  }
  const seen = new Set<string>()
  for (const entry of raw) {
    validateProjectInvariantEntry(entry, seen, errors)
  }
}

const PROJ_INVARIANT_ID_RE = /^PROJ-\d+$/

/** #2045: split out of validateGovernance to keep its cyclomatic complexity under the L2 ratchet. */
function validateSsotGuardPatterns(raw: unknown, errors: string[]): void {
  if (raw === undefined) return
  if (!Array.isArray(raw) || raw.some((p) => typeof p !== 'string')) {
    errors.push('governance.ssotGuardPatterns must be an array of strings')
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

// #2043 (AC-2043.2): per-project floor — 2..4 keeps the trio configurable without
// letting a project shrink the floor to 0/1 (defeats the gate) or bloat it past a
// reasonable acceptance-journey count.
const SMOKE_JOURNEYS_MIN = 2
const SMOKE_JOURNEYS_MAX = 4
// #2043 (AC-2043.2): an escalation that fires on the FIRST failure (maxStrikes:1)
// isn't a ladder — it's a hair-trigger. 2 is the floor.
const E2E_MAX_STRIKES_MIN = 2

function validateSmokeJourneys(raw: unknown, errors: string[]): void {
  if (raw === undefined || raw === null) return
  if (!isRecord(raw)) {
    errors.push('smokeJourneys must be an object')
    return
  }
  const requiredJourneys = raw['requiredJourneys']
  if (
    requiredJourneys !== undefined &&
    (!Array.isArray(requiredJourneys) || requiredJourneys.some((j) => typeof j !== 'string'))
  ) {
    errors.push('smokeJourneys.requiredJourneys must be an array of strings')
  }
  const minJourneys = raw['minJourneys']
  if (minJourneys !== undefined) {
    const valid =
      typeof minJourneys === 'number' &&
      Number.isInteger(minJourneys) &&
      minJourneys >= SMOKE_JOURNEYS_MIN &&
      minJourneys <= SMOKE_JOURNEYS_MAX
    if (!valid) {
      errors.push(
        `smokeJourneys.minJourneys must be an integer between ${SMOKE_JOURNEYS_MIN} and ${SMOKE_JOURNEYS_MAX}`,
      )
    }
  }
}

/**
 * #2401: every ship bound counts something that must exist at least once — a train carrying
 * zero issues, or a review allowed zero rounds, is the feature switched off by typo rather
 * than by decision. Rejected at the trust boundary so the ship never reads an absurd bound.
 */
function validateShipBound(path: string, raw: unknown, errors: string[]): void {
  if (raw === undefined) return
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    errors.push(`${path} must be an integer >= 1`)
  }
}

function validateShipSection(
  path: string,
  raw: unknown,
  bounds: readonly string[],
  errors: string[],
): void {
  if (raw === undefined || raw === null) return
  if (!isRecord(raw)) {
    errors.push(`${path} must be an object`)
    return
  }
  for (const bound of bounds) validateShipBound(`${path}.${bound}`, raw[bound], errors)
}

function validateShip(raw: unknown, errors: string[]): void {
  if (raw === undefined || raw === null) return
  if (!isRecord(raw)) {
    errors.push('ship must be an object')
    return
  }
  validateShipSection('ship.train', raw['train'], ['maxChain', 'maxAgeMinutes'], errors)
  validateShipSection('ship.review', raw['review'], ['maxRounds'], errors)
}

function validateE2ePolicy(raw: unknown, errors: string[]): void {
  if (raw === undefined || raw === null) return
  if (!isRecord(raw)) {
    errors.push('e2ePolicy must be an object')
    return
  }
  const escalation = raw['escalation']
  if (escalation === undefined || escalation === null) return
  if (!isRecord(escalation)) {
    errors.push('e2ePolicy.escalation must be an object')
    return
  }
  const strikes = escalation['strikes']
  if (!Array.isArray(strikes) || strikes.some((s) => typeof s !== 'number')) {
    errors.push('e2ePolicy.escalation.strikes must be an array of numbers')
  }
  const maxStrikes = escalation['maxStrikes']
  const validMaxStrikes =
    typeof maxStrikes === 'number' &&
    Number.isInteger(maxStrikes) &&
    maxStrikes >= E2E_MAX_STRIKES_MIN
  if (!validMaxStrikes) {
    errors.push(`e2ePolicy.escalation.maxStrikes must be an integer >= ${E2E_MAX_STRIKES_MIN}`)
  }
}
