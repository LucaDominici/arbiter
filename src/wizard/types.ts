export type Language = 'typescript' | 'java' | 'rust' | 'python' | 'go' | 'unknown';
export type GovernanceLevel = 'L1' | 'L2' | 'L3';
export type AiTool = 'claude' | 'codex' | 'cursor' | 'copilot';

export interface LanguageHook {
  /** Name of the hook script to generate (e.g. "check-no-any.sh") */
  name: string;
  /** What it enforces (for AGENTS.md invariant docs) */
  description: string;
  /** Hook body (bash) */
  body: string;
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
    checkAllSh: boolean;
  };

  languageHooks: LanguageHook[];
}
