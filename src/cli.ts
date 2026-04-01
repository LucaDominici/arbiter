#!/usr/bin/env node
import { Command } from 'commander';
import { runInit } from './commands/init.js';
import { runUpdate } from './commands/update.js';
import { runDiff } from './commands/diff.js';

const program = new Command();

program
  .name('arbiter')
  .description('AI development governance framework')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize AI governance in a project')
  .option('-y, --yes', 'Skip wizard — use auto-detected defaults', false)
  .option('--tools <tools>', 'Comma-separated list of AI tools (claude,codex,cursor,copilot)')
  .option('--level <level>', 'Governance level: L1, L2, or L3', 'L2')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action(async (opts: { yes: boolean; tools?: string; level?: string; dir?: string }) => {
    await runInit({
      yes: opts.yes,
      tools: opts.tools,
      level: opts.level,
      dir: opts.dir,
    });
  });

program
  .command('update')
  .description('Re-generate governance files using stored config (arbiter.json)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--github', 'Force GitHub setup even if disabled in stored config', false)
  .action((opts: { dir?: string; github: boolean }) => {
    runUpdate({
      dir: opts.dir,
      github: opts.github,
    });
  });

program
  .command('diff')
  .description('Show what arbiter update would change (dry run)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action((opts: { dir?: string }) => {
    runDiff({ dir: opts.dir });
  });

program.parse();
