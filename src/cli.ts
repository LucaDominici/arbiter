#!/usr/bin/env node
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runUpdate } from "./commands/update.js";
import { runDiff } from "./commands/diff.js";
import {
  runWorktreeOpen,
  runWorktreeClose,
  runWorktreeList,
} from "./commands/worktree.js";

const program = new Command();

program
  .name("arbiter")
  .description("AI development governance framework")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize AI governance in a project")
  .option("-y, --yes", "Skip wizard — use auto-detected defaults", false)
  .option(
    "--tools <tools>",
    "Comma-separated list of AI tools (claude,codex,cursor,copilot)",
  )
  .option("--level <level>", "Governance level: L1, L2, or L3", "L2")
  .option("--dir <dir>", "Target directory (default: current directory)")
  .option(
    "--dry-run",
    "Preview what would be generated without writing files",
    false,
  )
  .action(
    async (opts: {
      yes: boolean;
      tools?: string;
      level?: string;
      dir?: string;
      dryRun: boolean;
    }) => {
      await runInit({
        yes: opts.yes,
        tools: opts.tools,
        level: opts.level,
        dir: opts.dir,
        dryRun: opts.dryRun,
      });
    },
  );

program
  .command("update")
  .description(
    "Re-generate governance files using stored config (arbiter.json)",
  )
  .option("--dir <dir>", "Target directory (default: current directory)")
  .option(
    "--github",
    "Force GitHub setup even if disabled in stored config",
    false,
  )
  .action((opts: { dir?: string; github: boolean }) => {
    runUpdate({
      dir: opts.dir,
      github: opts.github,
    });
  });

program
  .command("diff")
  .description("Show what arbiter update would change (dry run)")
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action((opts: { dir?: string }) => {
    runDiff({ dir: opts.dir });
  });

const worktree = program
  .command("worktree")
  .alias("wt")
  .description("Manage git worktrees for parallel task development");

worktree
  .command("open <task-id> [slug]")
  .description(
    "Create a sibling worktree with a task branch and symlinked local files",
  )
  .option("--base <branch>", "Base branch to branch from", "main")
  .action(
    (taskId: string, slug: string | undefined, opts: { base: string }) => {
      runWorktreeOpen({
        taskId,
        ...(slug !== undefined ? { slug } : {}),
        base: opts.base,
      });
    },
  );

worktree
  .command("close <task-id>")
  .description("Tear down a task worktree after its branch is merged")
  .option("--force", "Close even if branch is unmerged or hook fails", false)
  .option("--keep-branch", "Do not delete the task branch after closing", false)
  .option("--no-fetch", "Skip git fetch before the merge check", false)
  .action(
    (
      taskId: string,
      opts: { force: boolean; keepBranch: boolean; fetch: boolean },
    ) => {
      runWorktreeClose({
        taskId,
        force: opts.force,
        keepBranch: opts.keepBranch,
        noFetch: !opts.fetch,
      });
    },
  );

worktree
  .command("list")
  .description("List open task worktrees")
  .action(() => {
    runWorktreeList();
  });

program.parse();
