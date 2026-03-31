import { resolve, basename } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { detectLanguage } from '../detectors/language.js';
import { detectBuildCommands } from '../detectors/build.js';
import { detectFramework } from '../detectors/framework.js';
import { detectGitInfo } from '../detectors/git.js';
import { detectExisting } from '../detectors/existing.js';
import { getLanguageHooks } from '../detectors/language-hooks.js';
import { loadConfig } from '../utils/config.js';
import { generateAgentsMd } from '../generators/agents-md.js';
import { generateClaude } from '../generators/claude.js';
import { generateCodex } from '../generators/codex.js';
import { generateGithub } from '../generators/github.js';
import { generateRoot } from '../generators/root.js';
import { generateCheckAll } from '../generators/check-all.js';
import { generateCursor } from '../generators/cursor.js';
import { generateCopilot } from '../generators/copilot.js';
import { renderTemplate } from '../utils/render.js';
import { resolvedPath } from '../utils/fs.js';

export interface DiffOptions {
  dir: string | undefined;
}

export function runDiff(options: DiffOptions): void {
  const targetDir = resolve(options.dir ?? process.cwd());
  const projectName = basename(targetDir);

  console.log('\n  Arbiter — diff (dry run)\n');

  const stored = loadConfig(targetDir);
  if (!stored) {
    console.log('  No arbiter.json found. Run `arbiter init` first.\n');
    process.exit(1);
  }

  const language = detectLanguage(targetDir);
  const framework = detectFramework(targetDir, language);
  const buildCmds = detectBuildCommands(targetDir, language);
  const gitInfo = detectGitInfo(targetDir);
  const existing = detectExisting(targetDir);

  const config = {
    targetDir,
    projectName,
    description: `${projectName} project`,
    language, framework,
    buildTool: buildCmds.buildTool, buildCommand: buildCmds.buildCommand,
    testCommand: buildCmds.testCommand, lintCommand: buildCmds.lintCommand,
    formatCommand: buildCmds.formatCommand,
    tools: stored.tools, governanceLevel: stored.governanceLevel,
    useGitHub: stored.useGitHub,
    githubOwner: gitInfo.githubOwner, githubRepo: gitInfo.githubRepo,
    existing, languageHooks: getLanguageHooks(language),
  };

  const data = config as unknown as Record<string, unknown>;
  const checks: Array<{ path: string; templateKey: string; content: () => string }> = [
    {
      path: resolvedPath(targetDir, 'AGENTS.md'),
      templateKey: 'AGENTS.md',
      content: () => renderTemplate('agents-md/AGENTS.md.ejs', data),
    },
    ...(config.tools.includes('claude') ? [
      { path: resolvedPath(targetDir, '.claude', 'CLAUDE.md'), templateKey: '.claude/CLAUDE.md', content: () => renderTemplate('claude/CLAUDE.md.ejs', data) },
    ] : []),
    ...(config.tools.includes('codex') ? [
      { path: resolvedPath(targetDir, '.agents', 'CODEX.md'), templateKey: '.agents/CODEX.md', content: () => renderTemplate('codex/CODEX.md.ejs', data) },
    ] : []),
    ...(config.tools.includes('cursor') ? [
      { path: resolvedPath(targetDir, '.cursorrules'), templateKey: '.cursorrules', content: () => renderTemplate('cursor/.cursorrules.ejs', data) },
    ] : []),
    ...(config.tools.includes('copilot') ? [
      { path: resolvedPath(targetDir, '.github', 'copilot-instructions.md'), templateKey: '.github/copilot-instructions.md', content: () => renderTemplate('copilot/copilot-instructions.md.ejs', data) },
    ] : []),
  ];

  let hasChanges = false;
  for (const check of checks) {
    const incoming = check.content();
    if (!existsSync(check.path)) {
      console.log(`  + ${check.templateKey}  (new file)`);
      hasChanges = true;
    } else {
      const current = readFileSync(check.path, 'utf-8');
      if (current !== incoming) {
        console.log(`  ~ ${check.templateKey}  (would update)`);
        hasChanges = true;
      } else {
        console.log(`  = ${check.templateKey}  (unchanged)`);
      }
    }
  }

  if (!hasChanges) {
    console.log('\n  All files up to date. Nothing to update.\n');
  } else {
    console.log('\n  Run `arbiter update` to apply changes.\n');
  }
}
