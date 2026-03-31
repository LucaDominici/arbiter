import { resolve, basename } from 'node:path';
import { detectLanguage } from '../detectors/language.js';
import { detectBuildCommands } from '../detectors/build.js';
import { detectFramework } from '../detectors/framework.js';
import { detectGitInfo } from '../detectors/git.js';
import { detectExisting } from '../detectors/existing.js';
import { detectGithubAccess } from '../detectors/github.js';
import { getLanguageHooks } from '../detectors/language-hooks.js';
import { runWizard } from '../wizard/prompts.js';
import { generateAgentsMd } from '../generators/agents-md.js';
import { generateClaude } from '../generators/claude.js';
import { generateCodex } from '../generators/codex.js';
import type { ProjectConfig, AiTool, GovernanceLevel } from '../wizard/types.js';
import type { WriteResult } from '../utils/fs.js';

export interface InitOptions {
  yes: boolean;
  tools: string | undefined;
  level: string | undefined;
  dir: string | undefined;
}

export async function runInit(options: InitOptions): Promise<void> {
  const targetDir = resolve(options.dir ?? process.cwd());
  const projectName = basename(targetDir);

  console.log('\n  Arbiter — AI Development Governance Framework\n');
  console.log('  Detecting project...');

  // Phase 1: Detect
  const language = detectLanguage(targetDir);
  const framework = detectFramework(targetDir, language);
  const buildCmds = detectBuildCommands(targetDir, language);
  const gitInfo = detectGitInfo(targetDir);
  const existing = detectExisting(targetDir);
  const githubAccess = detectGithubAccess();

  console.log(`  ├── Language: ${language}${framework ? ` / ${framework}` : ''}`);
  console.log(`  ├── Build: ${buildCmds.buildTool}`);
  console.log(`  ├── Git: ${gitInfo.isGitRepo ? 'yes' : 'no'}${gitInfo.githubRepo ? ` (${gitInfo.githubOwner}/${gitInfo.githubRepo})` : ''}`);
  if (existing.agentsMd) console.log('  ├── Existing AGENTS.md detected — will back up');
  if (existing.claudeDir) console.log('  ├── Existing .claude/ detected — will merge');
  if (existing.agentsDir) console.log('  ├── Existing .agents/ detected — will merge');

  // Phase 2: Wizard (or --yes defaults)
  let config: ProjectConfig;

  if (options.yes) {
    config = buildDefaultConfig({
      targetDir,
      projectName,
      language,
      framework,
      buildCmds,
      gitInfo,
      existing,
      tools: parseTools(options.tools),
      governanceLevel: parseLevel(options.level),
      useGitHub: githubAccess.authenticated,
    });
  } else {
    config = await runWizard({
      targetDir,
      projectName,
      language,
      framework,
      buildCmds,
      gitInfo,
      existing,
      githubAccess,
    });
  }

  // Phase 3: Generate
  console.log('\n  Generating...');
  const allResults: WriteResult[] = [];

  // AGENTS.md (always)
  allResults.push(generateAgentsMd(config));

  // Claude Code
  if (config.tools.includes('claude')) {
    const r = generateClaude(config);
    allResults.push(...r.files);
  }

  // Codex
  if (config.tools.includes('codex')) {
    const r = generateCodex(config);
    allResults.push(...r.files);
  }

  // Print results
  for (const result of allResults) {
    const icon = result.action === 'created' ? '├──' : result.action === 'skipped' ? '│  ' : '├──';
    const label = result.action === 'skipped' ? ' (skipped — already exists)' : result.action === 'backed-up-and-replaced' ? ' (backed up + replaced)' : '';
    const relPath = result.path.replace(targetDir + '/', '');
    console.log(`  ${icon} ${relPath}${label}`);
  }

  const created = allResults.filter(r => r.action === 'created').length;
  const skipped = allResults.filter(r => r.action === 'skipped').length;
  console.log(`\n  Done! ${created} files created, ${skipped} skipped.`);
  console.log(`\n  Run: ./scripts/check-all.sh L1  to verify\n`);
}

function buildDefaultConfig(opts: {
  targetDir: string;
  projectName: string;
  language: ReturnType<typeof detectLanguage>;
  framework: string | null;
  buildCmds: ReturnType<typeof detectBuildCommands>;
  gitInfo: ReturnType<typeof detectGitInfo>;
  existing: ReturnType<typeof detectExisting>;
  tools: AiTool[];
  governanceLevel: GovernanceLevel;
  useGitHub: boolean;
}): ProjectConfig {
  return {
    targetDir: opts.targetDir,
    projectName: opts.projectName,
    description: `${opts.projectName} project`,
    language: opts.language,
    framework: opts.framework,
    buildTool: opts.buildCmds.buildTool,
    buildCommand: opts.buildCmds.buildCommand,
    testCommand: opts.buildCmds.testCommand,
    lintCommand: opts.buildCmds.lintCommand,
    formatCommand: opts.buildCmds.formatCommand,
    tools: opts.tools,
    governanceLevel: opts.governanceLevel,
    useGitHub: opts.useGitHub,
    githubOwner: opts.gitInfo.githubOwner,
    githubRepo: opts.gitInfo.githubRepo,
    existing: opts.existing,
    languageHooks: getLanguageHooks(opts.language),
  };
}

function parseTools(tools: string | undefined): AiTool[] {
  if (!tools) return ['claude', 'codex'];
  return tools.split(',').filter((t): t is AiTool => ['claude', 'codex', 'cursor', 'copilot'].includes(t));
}

function parseLevel(level: string | undefined): GovernanceLevel {
  if (level === 'L1' || level === 'L2' || level === 'L3') return level;
  return 'L2';
}
