import inquirer from 'inquirer';
import type { ProjectConfig, AiTool, GovernanceLevel, Language } from './types.js';
import type { BuildCommands } from '../detectors/build.js';
import type { GitInfo } from '../detectors/git.js';
import type { ExistingState } from '../detectors/existing.js';
import type { GithubAccess } from '../detectors/github.js';
import { getLanguageHooks } from '../detectors/language-hooks.js';

export interface WizardInput {
  targetDir: string;
  projectName: string;
  language: Language;
  framework: string | null;
  buildCmds: BuildCommands;
  gitInfo: GitInfo;
  existing: ExistingState;
  githubAccess: GithubAccess;
}

export async function runWizard(wizardInput: WizardInput): Promise<ProjectConfig> {
  console.log('');

  const githubChoice = buildGithubChoice(wizardInput.githubAccess);

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'description',
      message: 'Project description:',
      default: `${wizardInput.projectName} project`,
    },
    {
      type: 'checkbox',
      name: 'tools',
      message: 'Which AI tools will you use?',
      choices: [
        { name: 'Claude Code (Anthropic)', value: 'claude', checked: true },
        { name: 'Codex (OpenAI)', value: 'codex', checked: true },
        { name: 'Cursor', value: 'cursor', checked: false },
        { name: 'Copilot', value: 'copilot', checked: false },
      ],
    },
    {
      type: 'list',
      name: 'governanceLevel',
      message: 'Governance level:',
      choices: [
        { name: 'L1 — Fast checks only (lint + format + unit tests)', value: 'L1' },
        { name: 'L2 — Full gate (L1 + coverage + integration)  [recommended]', value: 'L2' },
        { name: 'L3 — Audit grade (L2 + E2E + evidence)', value: 'L3' },
      ],
      default: 'L2',
    },
    ...githubChoice,
  ] as Parameters<typeof inquirer.prompt>[0]);

  const typed = answers as {
    description: string;
    tools: AiTool[];
    governanceLevel: GovernanceLevel;
    useGitHub?: 'yes' | 'no';
  };

  return {
    targetDir: wizardInput.targetDir,
    projectName: wizardInput.projectName,
    description: typed.description,
    language: wizardInput.language,
    framework: wizardInput.framework,
    buildTool: wizardInput.buildCmds.buildTool,
    buildCommand: wizardInput.buildCmds.buildCommand,
    testCommand: wizardInput.buildCmds.testCommand,
    lintCommand: wizardInput.buildCmds.lintCommand,
    formatCommand: wizardInput.buildCmds.formatCommand,
    tools: typed.tools.length > 0 ? typed.tools : ['claude', 'codex'],
    governanceLevel: typed.governanceLevel,
    useGitHub: typed.useGitHub === 'yes',
    githubOwner: wizardInput.gitInfo.githubOwner,
    githubRepo: wizardInput.gitInfo.githubRepo,
    existing: wizardInput.existing,
    languageHooks: getLanguageHooks(wizardInput.language),
  };
}

function buildGithubChoice(access: GithubAccess): object[] {
  if (!access.available) {
    return [];
  }
  if (!access.authenticated) {
    console.log(`  Note: ${access.error ?? 'gh not authenticated — GitHub assets skipped'}`);
    return [];
  }
  return [
    {
      type: 'list',
      name: 'useGitHub',
      message: 'Generate GitHub assets? (.github/ workflows, templates, labels)',
      choices: [
        { name: `Yes — gh authenticated as ${access.username ?? 'unknown'}`, value: 'yes' },
        { name: 'No — skip GitHub setup', value: 'no' },
      ],
      default: 'yes',
    },
  ];
}
