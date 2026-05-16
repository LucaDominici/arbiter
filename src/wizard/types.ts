// SPDX-License-Identifier: Apache-2.0
export type InvariantTier = 'architectural' | 'data' | 'security' | 'operational' | 'governance'

export type InvariantPreset = 'essential' | 'standard' | 'full'

export type WizardFlow = 'greenfield' | 'brownfield'

export interface WizardAnswers {
  description: string
  tools: AiTool[]
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
  /** #470: solo-dev mode — skip PR CI, merge directly after local L2 gate passes. Default false. */
  soloDevMode?: boolean
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
export type GovernanceLevel = 'L1' | 'L2' | 'L3'
export type AiTool = 'claude' | 'codex' | 'cursor' | 'copilot' | 'gemini' | 'windsurf' | 'aider'

export type Archetype =
  | 'backend-web-db'
  | 'cli'
  | 'library'
  | 'data-pipeline'
  | 'frontend-spa'
  | 'embedded'

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

export type WorktreeLinkStrategy = 'symlink' | 'copy'

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
  /** Optional script to run before removing the worktree on close.
   *  Receives the worktree path as its first argument. */
  closeHook: string | null
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
  /** Whether to generate security scanning gates (PII scan, gitleaks, dep audit). Defaults to true for L2+. */
  enableSecurityScanning: boolean
  /** Which invariant tiers to include in generated AGENTS.md. Derived from InvariantPreset. */
  invariantTiers: InvariantTier[]
  /** Base Java package (e.g. "com.example.myapp"). Detected from pom.xml/build.gradle for Java projects. */
  basePackage?: string
  /** Whether to generate mutation testing configuration. Default true for L2+. */
  enableMutationTesting?: boolean
  /** Whether to generate contract testing configuration. Default from contractType. */
  enableContractTesting?: boolean
  /** Whether to generate evidence retention configuration. Default true for L3. */
  enableEvidenceHarness?: boolean
  /** Whether to generate the A/B/C self-validation drill harness. Default true. */
  enableSelfValidationHarness?: boolean
  /** Whether to enable solo-dev mode: skip PR CI ceremony, nightly drift shadow. Default false. */
  enableSoloDevMode?: boolean
  /** Whether to generate the MCP fallback determinism rule (45-mcp-fallback.md). Default false (opt-in). */
  enableMcpFallback?: boolean
  /** Whether to generate check-no-skipped-tests.mjs hook. Default true for all governance levels. */
  enableNoSkippedTests?: boolean
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
}

export type PlanDepth = 'minimal' | 'brief' | 'full'

export interface TaskTierConfig {
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

export type EvidenceRetentionMode = 'local-last-N' | 'external-bucket' | 'none'

export interface EvidenceRetentionConfig {
  mode: EvidenceRetentionMode
  /** For local-last-N: number of runs to keep. Default 5. */
  count?: number
  /** For external-bucket: target URL (e.g. s3://bucket/path). */
  bucketUrl?: string
}
