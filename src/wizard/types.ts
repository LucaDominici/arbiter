// SPDX-License-Identifier: Apache-2.0
export type InvariantTier = 'architectural' | 'data' | 'security' | 'operational' | 'governance'

export type InvariantPreset = 'essential' | 'standard' | 'full'

/**
 * Meta-preset that bundles governance, compliance, observability, and auth config
 * into a single opt-in. Providers remain 'none' — user fills them in separately.
 */
export type ProjectPreset = 'none' | 'industrial-grade' | 'solo-homelab'

export type WizardFlow = 'greenfield' | 'brownfield'

/**
 * #1291/#1261 (ADR-093 §4) — ship autonomy level, the Project Profile automation
 * axis. L0 ask-each-step · L1 auto-advance/auto-merge · L2 + fix-on-red attempt ·
 * L3 full-auto wave + autonomous fix push + sub-agent spawn.
 * Lives here (not config/schema.ts) so WizardAnswers can use it without an
 * import cycle; config/schema.ts re-exports it for its existing consumers.
 */
export type AutonomyLevel = 'L0' | 'L1' | 'L2' | 'L3'

export interface WizardAnswers {
  description: string
  tools: AiTool[]
  language: Language
  governanceLevel: GovernanceLevel
  invariantPreset?: InvariantPreset
  archetype: Archetype
  architectureStyle: ArchitectureStyle
  hasDatabase: boolean
  hasPublicApi: boolean
  isMultiTenant: boolean
  decompositionBackend?: 'github' | 'markdown'
  /** Phase 9.5 ML: set only when hasPublicApi=true. Absent = default "none". */
  contractType?: ContractType
  /**
   * ADR-051: collaboration mode axis. Drives branching strategy, CI shape, and merge method.
   * When absent, defaults to 'peer-review' (safe default). Overrides soloDevMode when both present.
   */
  collaborationMode?: CollaborationMode
  /**
   * ADR-051: branching strategy. When absent, derived from collaborationMode.
   * Explicit value overrides the derived default.
   */
  branchingStrategy?: BranchingStrategy
  /**
   * #470: solo-dev mode — skip PR CI, merge directly after local L2 gate passes. Default false.
   * @deprecated Use collaborationMode: 'trunk-solo' instead. Kept as alias for one minor version.
   */
  soloDevMode?: boolean
  /** #1005: container registry / cloud deploy target. Absent = 'none'. */
  deployTarget?: DeployTarget
  /** Pipeline style: controls which GitHub Actions workflow set is emitted. Default 'standard'. */
  pipelineStyle?: 'starter' | 'standard' | 'industrial'
  /** Brownfield class: how mature the target repo is. Auto-detected; user can override. */
  brownfieldClass?: 'gold' | 'light' | 'medium' | 'heavy'
  /**
   * #1254: industry compliance overlay axis surfaced in the wizard. Absent = 'none'.
   * Drives the gdpr/iso27001/iso9001/pharma overlay generators and the
   * (overlay × governanceLevel) coherence advisory.
   */
  industryOverlay?:
    | 'pharma'
    | 'sox'
    | 'gdpr'
    | 'generic'
    | 'iso27001'
    | 'iso9001'
    | 'regulated'
    | 'none'
  /**
   * #1261: ship autonomy level chosen in the wizard. Absent = 'L0'
   * (ask at each ship step — the safe default).
   */
  autonomy?: AutonomyLevel
  /**
   * #1693 (ADR-101): runner profile axis. 'solo' moves the fuzz + soak-e2e
   * heavy jobs from nightly to weekly cadence (single self-hosted runner).
   * Default 'fleet' — current behavior, jobs stay nightly.
   */
  runnerProfile?: 'solo' | 'fleet'
}

export interface MigrationPlan {
  preserved: string[]
  merged: string[]
  replaced: string[]
  created: string[]
}

export type Language =
  | 'typescript'
  | 'java'
  | 'kotlin'
  | 'rust'
  | 'python'
  | 'go'
  | 'multi'
  | 'unknown'
export type GovernanceLevel = 'L1' | 'L2' | 'L3' | 'L4'
// AI coding tools arbiter can target. Canonical support policy (read before
// widening any user-facing surface):
//
//   SUPPORTED (customer-facing): 'claude' and 'codex' ONLY. These two are
//   dogfooded end-to-end — Claude Code daily; Codex via a runnable adapter with
//   empirical tests — so they are the surface advertised by `init --tools`,
//   offered in the wizard, and documented.
//
//   EXPERIMENTAL (NOT customer-facing): 'cursor' | 'copilot' | 'gemini' |
//   'windsurf' | 'aider'. Their generators/emitters produce config but are NOT
//   validated against the live tool; advertising them would be an overclaim.
//   The code is RETAINED and unit-tested for internal/experimental use, but
//   these values are rejected by `parseTools`, hidden from the wizard, and
//   absent from user-facing docs and `--help`. Do not re-expose without
//   end-to-end verification of the named tool.
export type AiTool = 'claude' | 'codex' | 'cursor' | 'copilot' | 'gemini' | 'windsurf' | 'aider'

export type Archetype =
  | 'backend-web-db'
  | 'cli'
  | 'library'
  | 'data-pipeline'
  | 'frontend-spa'
  | 'embedded'

export type DeployTarget = 'ghcr' | 'azure-container-app' | 'aws-ecs' | 'gcp-cloud-run' | 'none'

export type ArchitectureStyle = 'hexagonal' | 'layered' | 'modular-monolith' | 'none'

export type Lane = 'frontend' | 'backend' | 'docs'

/**
 * Computed from (language, archetype, architectureStyle) at generation time.
 * Not persisted on ProjectConfig — passed to EJS templates as `metricsProfile`.
 */
export interface MetricsProfile {
  /** frontend-spa + typescript only: include bundle size metric */
  includeBundleSize: boolean
  /** library + typescript: include public-API surface count */
  includePublicApiSurface: boolean
  /** backend-web-db or library: include branch coverage in addition to line */
  includeBranchCoverage: boolean
  /** java only: emit SpotBugs config and collect spotbugsViolations */
  spotbugsEnabled: boolean
  /** java + architectureStyle !== 'none': collect archunitFailingRules */
  archunitEnabled: boolean
}

export interface LanguageHook {
  /** Name of the hook script to generate (e.g. "check-no-any.mjs") */
  name: string
  /** What it enforces (for AGENTS.md invariant docs) */
  description: string
  /** Hook body (Node.js ESM) */
  body: string
}

/**
 * ADR-051: collaboration-mode axis — replaces soloDevMode/teamSize as the
 * primary driver for branching, CI shape, and merge method.
 * trunk-solo  = one author; direct push or opt-in pr-ff.
 * peer-review = 1+ reviewers, shared trust; mandatory PR with ff-only merge.
 * gated-review = CODEOWNERS, merge queue, attestation chain.
 */
export type CollaborationMode = 'trunk-solo' | 'peer-review' | 'gated-review'

/**
 * ADR-051: branching strategy driven by collaborationMode.
 * trunk-direct            = push directly to main (no long-lived branches).
 * github-flow             = feature branches → main only.
 * github-flow-with-develop = feature branches → develop → main.
 */
export type BranchingStrategy = 'trunk-direct' | 'github-flow' | 'github-flow-with-develop'

/** ADR-051: merge method for trunk-solo mode. */
export type SoloMergeMode = 'direct' | 'pr-ff'

/** ADR-051: whether /task auto-opens a worktree. */
export type WorktreeAutoMode = 'always' | 'optional' | 'never'

type WorktreeLinkStrategy = 'symlink' | 'copy'

export interface WorktreeLinkSpec {
  /** Relative path inside the repo (e.g. ".env", ".claude/settings.local.json") */
  path: string
  /** Throw if source is missing instead of silently skipping */
  required?: boolean
  /** Fallback: copy from this template path if source is absent */
  template?: string
  /** How to materialize the link (default: "symlink") */
  strategy?: WorktreeLinkStrategy
  /** Whether this is a file or directory link (default: "file") */
  type?: 'file' | 'directory'
}

export interface WorktreeConfig {
  /** Absolute path to the directory that holds all worktrees.
   *  null → sibling of the repo: <parent>/<repoName>.worktrees */
  base: string | null
  /** Files/dirs to symlink (or copy) from the main repo into each worktree */
  links: WorktreeLinkSpec[]
  /** Opt-in build-artifact links (target/, dist/, .next/) — activated via --with-build-links */
  buildLinks?: WorktreeLinkSpec[]
  /** Optional script to run before removing the worktree on close.
   *  Receives the worktree path as its first argument. */
  closeHook: string | null
}

/** Two-tier conformance scoring thresholds. Part of persisted arbiter.json config. */
export interface ConformanceThresholds {
  tier1Members: string[]
  familyWeights: {
    discipline: number
    'reality-contact': number
    'docs-convention': number
    'code-quality-gold': number
  }
  goldTier2Gate: number
}

export interface ProjectConfig {
  /** Directory being initialized */
  targetDir: string
  /** e.g. "coach-system" */
  projectName: string
  /** Short description (user-provided or inferred) */
  description: string
  language: Language
  /** e.g. "express+react", "spring-boot", "tauri" */
  framework: string | null
  /** Project archetype — shape of the runtime topology */
  archetype: Archetype
  /** Internal module decomposition style. Default "none" = no architecture rules generated */
  architectureStyle: ArchitectureStyle
  /** Whether the project handles multiple tenants sharing one deployment */
  isMultiTenant: boolean
  /** Whether the project connects to a database */
  hasDatabase: boolean
  /** Whether the project exposes a public API (REST, GraphQL, gRPC, etc.) */
  hasPublicApi: boolean
  /** e.g. "npm", "gradle", "cargo" */
  buildTool: string
  buildCommand: string
  testCommand: string
  lintCommand: string
  formatCommand: string

  tools: AiTool[]
  governanceLevel: GovernanceLevel

  useGitHub: boolean
  permitGitHub?: boolean
  decompositionBackend?: 'github' | 'markdown'
  githubOwner: string | null
  githubRepo: string | null

  existing: {
    agentsMd: boolean
    claudeDir: boolean
    agentsDir: boolean
    aiRulez: boolean
    settingsJson: boolean
    checkAllScript: boolean
    geminiDir: boolean
    windsurfRules: boolean
    aiderConf: boolean
  }

  languageHooks: LanguageHook[]
  /** Whether to generate tech debt prevention gates (coverage, complexity, dead code). Defaults to true for L2+. */
  enableDebtGates: boolean
  /** Whether to generate suppression templates and the check-suppressions.mjs expiry gate. Defaults to true for all governance levels. */
  enableSuppressions: boolean
  /**
   * Which database engine the project uses. Set when hasDatabase=true. Still
   * consumed by KIT applicability gating for dims N08/N73/N74/N75
   * (src/kit/applicability.ts) — NOT dead. Auto-detection is not yet
   * implemented (tracked by #1058); until then this is set manually or left unset
   * (requiresDbEngine dims fail-closed to NA). #1157.
   */
  databaseEngine?: 'postgresql' | 'mysql' | 'mongodb' | 'sqlite' | 'other' | 'none'
  /** Whether to generate security scanning gates (PII scan, gitleaks, dep audit). Defaults to true for L2+. */
  enableSecurityScanning: boolean
  /** Which invariant tiers to include in generated AGENTS.md. Derived from InvariantPreset. */
  invariantTiers: InvariantTier[]
  /** Base Java package (e.g. "com.example.myapp"). Detected from pom.xml/build.gradle for Java projects. */
  basePackage?: string
  /**
   * #257/#1524/#1616: domain-specific test-taxonomy dimensions. Consumed by the
   * test-taxonomy generator and round-tripped through arbiter.json so custom
   * dimensions survive `arbiter update`. Structural-typed here (not imported from
   * config/schema) to keep the wizard layer free of a config→wizard back-edge.
   */
  taxonomy?: { domainDims?: string[] }
  /** Whether to generate mutation testing configuration. Default true for L2+. */
  enableMutationTesting?: boolean
  /** Whether to generate contract testing configuration. Default from contractType. */
  enableContractTesting?: boolean
  /** Whether to generate evidence retention configuration. Default true for L3. */
  enableEvidenceHarness?: boolean
  /** Whether to generate the A/B/C self-validation drill harness. Default true. */
  enableSelfValidationHarness?: boolean
  /**
   * ADR-051: collaboration mode axis. Primary driver for branching, CI shape, merge method.
   * Absent = legacy mode (falls back to enableSoloDevMode → peer-review).
   */
  collaborationMode?: CollaborationMode
  /**
   * ADR-051: branching strategy. When absent, derived from collaborationMode defaults table.
   * github-flow-with-develop gates `develop` branch references in CI templates.
   */
  branchingStrategy?: BranchingStrategy
  /**
   * ADR-051: worktree auto-open behavior for /task command.
   * Derived from collaborationMode when absent.
   */
  tasks?: { worktree: WorktreeAutoMode }
  /**
   * ADR-051: trunk-solo merge method.
   * 'direct' = git push --ff-only without PR.
   * 'pr-ff'  = gh pr create + ff-only merge (audit trail preserved).
   * Only meaningful when collaborationMode = 'trunk-solo'.
   */
  solo?: { mergeMode: SoloMergeMode }
  /**
   * #1291 — ship autonomy gating (ADR-093 §4). Absent ⇒ L0.
   * #1306 (ADR-094 §Decision.4) — extended with three optional orchestration prefs;
   * all derived per collaboration mode / governance level when the wizard builds the
   * profile (see buildProfileAxes). Absent fields fall to their derived defaults.
   */
  automation?: {
    autonomy: AutonomyLevel
    maxParallelWorktrees?: number
    defaultGateLevel?: 'L1' | 'L2'
    affinityBatching?: boolean
  }
  /**
   * Whether to enable solo-dev mode: skip PR CI ceremony, nightly drift shadow. Default false.
   * @deprecated Use collaborationMode: 'trunk-solo' instead. Kept as alias for one minor version.
   */
  enableSoloDevMode?: boolean
  /** Whether to generate the MCP fallback determinism rule (45-mcp-fallback.md). Default false (opt-in). */
  enableMcpFallback?: boolean
  /** Whether to generate check-no-skipped-tests.mjs hook. Default true for all governance levels. */
  enableNoSkippedTests?: boolean
  /** Whether to use the 25-dimension test taxonomy template instead of the base 17-dimension one. Default false. */
  enableTaxonomy25d?: boolean
  /** Whether to generate the operations handbook (4-signal observability, RC checklist, runbooks). Default false. */
  enableOperationsHandbook?: boolean
  /** Whether to generate the risk register + P×I assessment template (ISO 27001 §6.1.2). Default false. */
  enableRiskRegister?: boolean
  /** Whether to include ISO 27001 Annex A gate-to-control mapping in the compliance document. Default false. */
  enableIso27001Mapping?: boolean
  /** Whether to include NIS2 Art.21.2 gate-to-requirement mapping in the compliance document. Default false. */
  enableNis2Mapping?: boolean
  /** Whether to include GDPR article gate-to-control mapping in the compliance document. Default false. */
  enableGdprMapping?: boolean
  /** Observability provider configuration. Default: absent (no observability files generated). */
  observability?: ObservabilityConfig
  /** Auth provider configuration. Default: absent (no auth setup files generated). */
  auth?: AuthConfig
  /** Frontend framework + tooling configuration. Absent = no framework-specific governance text. */
  frontend?: FrontendConfig
  /**
   * User explicitly acknowledges that one or more beta tools will be used.
   * Set by --accept-beta-tools on `arbiter init`. Persisted in arbiter.json for audit.
   * Beta tools (maturity="beta") require this flag; unsafe tools are never allowed.
   */
  acceptBetaTools?: boolean
  /**
   * Phase 9.5 MG: coverage/mutation threshold profile.
   * "scaled" = LoC-based ramp (no coverage <1000 LoC, no mutation <5000 LoC, 60%→85%).
   * "fixed"  = flat 80% (L2) / 85% (L3) regardless of project size.
   * Default: "scaled".
   */
  thresholdProfile?: ThresholdProfile
  /**
   * Phase 9.5 MG: enforcement strictness tier.
   * "practical" = standard rules for most teams.
   * "pedantic"  = additional rules: noUncheckedIndexedAccess (TS), clippy pedantic (Rust), etc.
   * Default: "practical".
   */
  strictnessTier?: StrictnessTier
  /**
   * Phase 9.5 MG: detected or estimated lines of code in the target project.
   * Used by "scaled" threshold profile to compute coverage/mutation gates.
   * 0 = unknown; treated same as <1000 LoC for scaled profile (coverage and mutation gates disabled).
   */
  linesOfCode?: number
  /**
   * Phase 9.5 MJ: evidence harness retention policy.
   * Controls how many evidence runs to keep and where to store them.
   * Default: { mode: "local-last-N", count: 5 }
   */
  evidenceRetention?: EvidenceRetentionConfig
  /**
   * Phase 9.5 ML: contract testing strategy — see ADR-028.
   * Wizard asks only if hasPublicApi === true. Default: "none".
   */
  contractType: ContractType
  /**
   * M25: path to k6 load test script (relative to project root).
   * Used by the generated nightly.yml. L3-only. Default: "tests/load/default.js".
   */
  k6ScriptPath?: string
  thresholds?: ThresholdsV2
  /** Detected project lanes (FE/BE/docs). Empty array = single-lane / no lane awareness. */
  lanes: Lane[]
  /** Task-tier configuration (XS/S/Standard) — review agent count + plan depth (#237). */
  taskTiers?: TaskTiers
  /** Active project preset, if any. Stored for audit/drift detection. */
  preset?: ProjectPreset
  /** Include extended opt-in invariants (INV-62..INV-71). True when governance.invariants_catalog = 'extended'. */
  includeExtendedInvariants?: boolean
  /**
   * CI tier emission mode.
   * @deprecated Use pipelineStyle instead. Kept for one minor version as a fallback alias.
   * 'baseline' = emit the 4-workflow baseline set (01/02/03/09) for self-CI migration.
   * 'full'     = emit all 8 standard CI tier workflows (default for target projects).
   */
  ciTierMode?: 'baseline' | 'full'

  /**
   * Container registry / cloud deploy target.
   * 'ghcr' = default for backend-web-db (home scenario). All others = paid-cloud targets.
   * 'none' = no deploy workflows emitted (default for all non-service archetypes).
   * Absent field treated as 'none'. Sole gate for deploy-workflow and Azure
   * Container Apps infra emission (#1145/#1146 removed the derived boolean flags).
   */
  deployTarget?: DeployTarget

  /**
   * Pipeline style: controls which GitHub Actions workflow set is emitted.
   * 'starter'    = 3 workflows (pr-fast, main-build, heartbeat)
   * 'standard'   = 8 workflows: starter + pr-extended, nightly, release, dependabot-auto, sbom, gitleaks
   * 'industrial' = full 18-workflow set (standard + perf, chaos, mutation, archunit-extended,
   *                cosign, attestation, rebuild-on-demand, trivy, license-scan, policy-eval)
   * Default: 'standard'. Takes precedence over ciTierMode when both are present.
   */
  pipelineStyle?: 'starter' | 'standard' | 'industrial'

  /**
   * Brownfield class: how mature the target repo is.
   * Determines which threshold column to apply for existing code.
   * Auto-detected by brownfield-detect.ts; user can override via wizard prompt.
   * 'gold'   = greenfield / already-mature (< 50 source files)
   * 'light'  = 50–500 files, coverage > 30 %
   * 'medium' = 500–2 000 files, coverage 5–30 %
   * 'heavy'  = 2 000+ files, coverage < 5 %
   */
  brownfieldClass?: 'gold' | 'light' | 'medium' | 'heavy'

  /**
   * Whether to run the kit-install lifecycle (DETECT → MEASURE → SCAFFOLD → ASSESS → PLAN → VERIFY).
   * Default: true when a supported stack is detected.
   */
  kitEnabled?: boolean

  /**
   * Industry overlay — emits domain-specific audit-trail compliance scaffolding.
   * 'pharma'            → pharma audit-trail overlay (KIT dims 73-75, ArchUnit R-35..R-39). Java only.
   * 'sox'|'gdpr'|'generic' → language-neutral L4 audit-trail docs + gate rules,
   *                       decoupled from the pharma Java scaffolding (#1156).
   * 'iso27001'          → ISO 27001:2022 Annex-A controls→gate traceability
   *                       overlay (security mgmt). Language-neutral (#1252).
   * 'iso9001'           → quality-process overlay (orthogonal to audit-trail):
   *                       requirement→test RTM, document-control register, CAPA log
   *                       + enforceable gate. Language-neutral (#1253).
   * 'none'              → no overlay (default).
   * Absent field is treated as 'none'.
   */
  industryOverlay?:
    | 'pharma'
    | 'sox'
    | 'gdpr'
    | 'generic'
    | 'iso27001'
    | 'iso9001'
    | 'regulated'
    | 'none'

  /**
   * F6: Emit k6 performance testing ecosystem.
   * Includes 12+ named scenario templates, 3 Python report generators,
   * seed SQL, validator script, and GitHub workflow.
   * Off by default — opt in when load/performance testing is needed (#895).
   */
  enablePerfTesting?: boolean

  /**
   * #943: emit _post-merge-notify.yml workflow that sends an email to CODEOWNERS
   * after each merged PR (result + coverage + changed files). L2+ only.
   * Off by default — requires MAIL_SERVER/MAIL_USERNAME/MAIL_PASSWORD secrets and
   * a MAIL_DOMAIN_ALLOWLIST variable (set to `*` to allow all domains).
   */
  enableCodeownersNotify?: boolean

  /**
   * #1693 (ADR-101): runner profile axis, orthogonal to collaborationMode/pipelineStyle.
   * 'fleet' (default) = current behavior: fuzz + soak-e2e heavy jobs run at nightly
   *   cadence, hard-gated by nightly-required.
   * 'solo' = fuzz + soak-e2e move to weekly cadence instead (single self-hosted
   *   runner that cannot absorb a nightly heavy sweep), while preserving the same
   *   hard-gate + issue-filing semantics at weekly cadence.
   * Absent field treated as 'fleet'.
   */
  runnerProfile?: 'solo' | 'fleet'
}

type PlanDepth = 'minimal' | 'brief' | 'full'

interface TaskTierConfig {
  planDepth: PlanDepth
  reviewAgentCount: number
}

export interface TaskTiers {
  XS: TaskTierConfig
  S: TaskTierConfig
  Standard: TaskTierConfig
}

export interface ThresholdsV2 {
  lineCoverage: number
  branchCoverage: number
  mutationScore: number
  cyclomaticComplexity: number
  methodLength: number
  maxParams: number
}

export type ThresholdProfile = 'scaled' | 'fixed'
export type StrictnessTier = 'practical' | 'pedantic'

/**
 * Phase 9.5 ML: contract testing strategy — see ADR-028.
 * "rest-owned"    → Pact consumer + provider (owned by your team).
 * "rest-public"   → OpenAPI diff (breaking-change detection for public API).
 * "graphql"       → Schema diff via graphql-inspector.
 * "grpc"          → buf breaking check.
 * "message-queue" → Schema registry integration (Avro, Protobuf).
 * "none"          → No contract testing generated.
 */
export type ContractType =
  | 'rest-owned'
  | 'rest-public'
  | 'graphql'
  | 'grpc'
  | 'message-queue'
  | 'none'

export type ObservabilityProvider =
  | 'none'
  | 'stdout-minimal'
  | 'victoria-vector-quickwit'
  | 'signoz'
  | 'openobserve'
  | 'prom-grafana-loki-jaeger'
  | 'saas-sentry'
  | 'saas-datadog'
  | 'saas-axiom'
  | 'saas-betterstack'

export interface ObservabilityConfig {
  provider: ObservabilityProvider
  metrics?: boolean
  logs?: boolean
  traces?: boolean
  alerts?: boolean
}

export type AuthProvider =
  | 'none'
  | 'app-level-ts'
  | 'authelia'
  | 'authentik'
  | 'ory-stack'
  | 'zitadel'
  | 'keycloak'
  | 'saas-clerk'
  | 'saas-auth0'
  | 'saas-supabase-auth'
  | 'saas-cognito'

export interface AuthConfig {
  provider: AuthProvider
  protocols?: Array<'oidc' | 'oauth2' | 'saml' | 'session'>
  tenantIsolation?: boolean
  themeSync?: boolean
}

export interface FrontendConfig {
  /** UI framework in use. Controls state-manager defaults in FE governance templates. */
  framework?: 'vue' | 'react' | 'svelte'
  /** State management library (e.g. 'pinia', 'zustand', 'svelte-store'). */
  stateManager?: string
  /** Schema validation library (e.g. 'zod', 'yup', 'valibot'). */
  validationLib?: string
}

type EvidenceRetentionMode = 'local-last-N' | 'external-bucket' | 'none'

export interface EvidenceRetentionConfig {
  mode: EvidenceRetentionMode
  /** For local-last-N: number of runs to keep. Default 5. */
  count?: number
  /** For external-bucket: target URL (e.g. s3://bucket/path). */
  bucketUrl?: string
}
