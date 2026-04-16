export type InvariantTier =
  | "architectural"
  | "data"
  | "security"
  | "operational"
  | "governance";

export type InvariantPreset = "essential" | "standard" | "full";

export type WizardFlow = "greenfield" | "brownfield";

export interface WizardAnswers {
  description: string;
  tools: AiTool[];
  governanceLevel: GovernanceLevel;
  invariantPreset?: InvariantPreset;
  archetype: Archetype;
  architectureStyle: ArchitectureStyle;
  hasDatabase: boolean;
  hasPublicApi: boolean;
  isMultiTenant: boolean;
  useGitHub?: "yes" | "no";
}

export interface MigrationPlan {
  preserved: string[];
  merged: string[];
  replaced: string[];
  created: string[];
}

export type Language =
  | "typescript"
  | "java"
  | "rust"
  | "python"
  | "go"
  | "unknown";
export type GovernanceLevel = "L1" | "L2" | "L3";
export type AiTool = "claude" | "codex" | "cursor" | "copilot";

export type Archetype =
  | "backend-web-db"
  | "cli"
  | "library"
  | "data-pipeline"
  | "frontend-spa"
  | "embedded";

export type ArchitectureStyle =
  | "hexagonal"
  | "layered"
  | "modular-monolith"
  | "none";

/**
 * Computed from (language, archetype, architectureStyle) at generation time.
 * Not persisted on ProjectConfig — passed to EJS templates as `metricsProfile`.
 */
export interface MetricsProfile {
  /** frontend-spa + typescript only: include bundle size metric */
  includeBundleSize: boolean;
  /** library + typescript: include public-API surface count */
  includePublicApiSurface: boolean;
  /** backend-web-db or library: include branch coverage in addition to line */
  includeBranchCoverage: boolean;
  /** java only: emit SpotBugs config and collect spotbugsViolations */
  spotbugsEnabled: boolean;
  /** java + architectureStyle !== 'none': collect archunitFailingRules */
  archunitEnabled: boolean;
}

export interface LanguageHook {
  /** Name of the hook script to generate (e.g. "check-no-any.mjs") */
  name: string;
  /** What it enforces (for AGENTS.md invariant docs) */
  description: string;
  /** Hook body (Node.js ESM) */
  body: string;
}

export type WorktreeLinkStrategy = "symlink" | "copy";

export interface WorktreeLinkSpec {
  /** Relative path inside the repo (e.g. ".env", ".claude/settings.local.json") */
  path: string;
  /** Throw if source is missing instead of silently skipping */
  required?: boolean;
  /** Fallback: copy from this template path if source is absent */
  template?: string;
  /** How to materialize the link (default: "symlink") */
  strategy?: WorktreeLinkStrategy;
  /** Whether this is a file or directory link (default: "file") */
  type?: "file" | "directory";
}

export interface WorktreeConfig {
  /** Absolute path to the directory that holds all worktrees.
   *  null → sibling of the repo: <parent>/<repoName>.worktrees */
  base: string | null;
  /** Files/dirs to symlink (or copy) from the main repo into each worktree */
  links: WorktreeLinkSpec[];
  /** Optional script to run before removing the worktree on close.
   *  Receives the worktree path as its first argument. */
  closeHook: string | null;
}

export interface ProjectConfig {
  /** Directory being initialized */
  targetDir: string;
  /** e.g. "coach-system" */
  projectName: string;
  /** Short description (user-provided or inferred) */
  description: string;
  language: Language;
  /** e.g. "express+react", "spring-boot", "tauri" */
  framework: string | null;
  /** Project archetype — shape of the runtime topology */
  archetype: Archetype;
  /** Internal module decomposition style. Default "none" = no architecture rules generated */
  architectureStyle: ArchitectureStyle;
  /** Whether the project handles multiple tenants sharing one deployment */
  isMultiTenant: boolean;
  /** Whether the project connects to a database */
  hasDatabase: boolean;
  /** Whether the project exposes a public API (REST, GraphQL, gRPC, etc.) */
  hasPublicApi: boolean;
  /** e.g. "npm", "gradle", "cargo" */
  buildTool: string;
  buildCommand: string;
  testCommand: string;
  lintCommand: string;
  formatCommand: string;

  tools: AiTool[];
  governanceLevel: GovernanceLevel;

  useGitHub: boolean;
  githubOwner: string | null;
  githubRepo: string | null;

  existing: {
    agentsMd: boolean;
    claudeDir: boolean;
    agentsDir: boolean;
    aiRulez: boolean;
    settingsJson: boolean;
    checkAllScript: boolean;
  };

  languageHooks: LanguageHook[];
  /** Whether to generate tech debt prevention gates (coverage, complexity, dead code). Defaults to true for L2+. */
  enableDebtGates: boolean;
  /** Whether to generate suppression templates and the check-suppressions.mjs expiry gate. Defaults to true for all governance levels. */
  enableSuppressions: boolean;
  /** Which invariant tiers to include in generated AGENTS.md. Derived from InvariantPreset. */
  invariantTiers: InvariantTier[];
  /** Base Java package (e.g. "com.example.myapp"). Detected from pom.xml/build.gradle for Java projects. */
  basePackage?: string;
  /** Whether to generate the optional Obsidian vault at docs/vault/. */
  enableObsidianVault?: boolean;
  /**
   * User explicitly acknowledges that one or more beta tools will be used.
   * Set by --accept-beta-tools on `arbiter init`. Persisted in arbiter.json for audit.
   * Beta tools (maturity="beta") require this flag; unsafe tools are never allowed.
   */
  acceptBetaTools?: boolean;
  /**
   * Phase 9.5 MJ: evidence harness retention policy.
   * Controls how many evidence runs to keep and where to store them.
   * Default: { mode: "local-last-N", count: 5 }
   */
  evidenceRetention?: EvidenceRetentionConfig;
}

export type EvidenceRetentionMode = "local-last-N" | "external-bucket" | "none";

export interface EvidenceRetentionConfig {
  mode: EvidenceRetentionMode;
  /** For local-last-N: number of runs to keep. Default 5. */
  count?: number;
  /** For external-bucket: target URL (e.g. s3://bucket/path). */
  bucketUrl?: string;
}
