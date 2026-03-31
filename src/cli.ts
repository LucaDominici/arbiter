#!/usr/bin/env node
import { Command } from 'commander';
import { runInit } from './commands/init.js';

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
  .action(async (opts) => {
    await runInit({
      yes: opts.yes as boolean,
      tools: opts.tools as string | undefined,
      level: opts.level as string | undefined,
      dir: opts.dir as string | undefined,
    });
  });

program.parse();
