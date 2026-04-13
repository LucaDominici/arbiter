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
  /** Which invariant tiers to include in generated AGENTS.md. Derived from InvariantPreset. */
  invariantTiers: InvariantTier[];
  /** Base Java package (e.g. "com.example.myapp"). Detected from pom.xml/build.gradle for Java projects. */
  basePackage?: string;
  /** Whether to generate the optional Obsidian vault at docs/vault/. */
  enableObsidianVault?: boolean;
}
