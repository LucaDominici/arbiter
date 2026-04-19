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
import { runVerify } from "./commands/verify.js";
import { runUpgradeLevel } from "./commands/upgrade-level.js";
import {
  runPluginAdd,
  runPluginRemove,
  runPluginList,
} from "./commands/plugin.js";

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
    "Comma-separated list of AI tools (claude,codex,cursor,copilot,gemini,windsurf,aider)",
  )
  .option("--level <level>", "Governance level: L1, L2, or L3", "L2")
  .option("--dir <dir>", "Target directory (default: current directory)")
  .option(
    "--dry-run",
    "Preview what would be generated without writing files",
    false,
  )
  .option(
    "--obsidian",
    "Generate optional Obsidian vault at docs/vault/",
    false,
  )
  .option(
    "--brownfield",
    "Auto-capture debt baseline after generation (locks current state as day-0 baseline)",
    false,
  )
  .option("--no-verify", "Skip toolchain compatibility probes after generation")
  .option(
    "--accept-beta-tools",
    "Allow generation of L3 features backed by beta-maturity tools (audit trail written to arbiter.json)",
    false,
  )
  .action(
    async (opts: {
      yes: boolean;
      tools?: string;
      level?: string;
      dir?: string;
      dryRun: boolean;
      obsidian: boolean;
      brownfield: boolean;
      verify: boolean;
      acceptBetaTools: boolean;
    }) => {
      await runInit({
        yes: opts.yes,
        tools: opts.tools,
        level: opts.level,
        dir: opts.dir,
        dryRun: opts.dryRun,
        obsidian: opts.obsidian,
        brownfield: opts.brownfield,
        noVerify: !opts.verify,
        acceptBetaTools: opts.acceptBetaTools,
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
  .action(async (opts: { dir?: string; github: boolean }) => {
    await runUpdate({
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
  .option(
    "--harvest",
    "Copy modified/untracked files back to main repo before closing",
    false,
  )
  .option(
    "--harvest-all",
    "Harvest all files and skip merge check (implies --force for cleanup)",
    false,
  )
  .action(
    (
      taskId: string,
      opts: {
        force: boolean;
        keepBranch: boolean;
        fetch: boolean;
        harvest: boolean;
        harvestAll: boolean;
      },
    ) => {
      runWorktreeClose({
        taskId,
        force: opts.force,
        keepBranch: opts.keepBranch,
        noFetch: !opts.fetch,
        harvest: opts.harvest,
        harvestAll: opts.harvestAll,
      });
    },
  );

worktree
  .command("list")
  .description("List open task worktrees")
  .action(() => {
    runWorktreeList();
  });

program
  .command("verify")
  .description("Probe toolchain compatibility for the detected stack")
  .option("--json", "Emit JSON report", false)
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action((opts: { json: boolean; dir?: string }) => {
    runVerify({ json: opts.json, dir: opts.dir });
  });

program
  .command("upgrade-level")
  .description("Upgrade governance level with a grace period for new gates")
  .option("--target <level>", "Target level (L2 or L3)")
  .option(
    "--extend",
    "Extend an existing active grace period by --days (default: 30)",
    false,
  )
  .option("--days <n>", "Grace period length in days (default: 30)", parseInt)
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action(
    (opts: {
      target?: string;
      extend: boolean;
      days?: number;
      dir?: string;
    }) => {
      const upgradeOpts: import("./commands/upgrade-level.js").UpgradeLevelOptions =
        { extend: opts.extend };
      if (opts.target) {
        if (opts.target !== "L2" && opts.target !== "L3") {
          console.error(
            `  Error: invalid --target "${opts.target}". Valid values: L2, L3.`,
          );
          process.exit(1);
        }
        upgradeOpts.target =
          opts.target as import("./wizard/types.js").GovernanceLevel;
      }
      if (opts.days !== undefined) upgradeOpts.days = opts.days;
      if (opts.dir !== undefined) upgradeOpts.dir = opts.dir;
      runUpgradeLevel(upgradeOpts);
    },
  );

program
  .command("obsidian")
  .description("Generate or sync the optional Obsidian vault at docs/vault/")
  .option(
    "--sync",
    "Update only files with the arbiter:generated marker",
    false,
  )
  .option(
    "--github-only",
    "Refresh only github/ notes, skip module rescan",
    false,
  )
  .option("--dry-run", "Preview writes without touching disk", false)
  .option(
    "--force",
    "Overwrite non-generated files and ignore config flag",
    false,
  )
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action(
    async (opts: {
      sync: boolean;
      githubOnly: boolean;
      dryRun: boolean;
      force: boolean;
      dir?: string;
    }) => {
      const { runObsidian } = await import("./commands/obsidian.js");
      await runObsidian({
        sync: opts.sync,
        dryRun: opts.dryRun,
        force: opts.force,
        githubOnly: opts.githubOnly,
        dir: opts.dir,
      });
    },
  );

const plugin = program.command("plugin").description("Manage arbiter plugins");

plugin
  .command("add <pkg>")
  .description(
    "Add a plugin to this project (validates it is resolvable first)",
  )
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action(async (pkg: string, opts: { dir?: string }) => {
    await runPluginAdd({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      pkg,
    });
  });

plugin
  .command("remove <pkg>")
  .description("Remove a plugin from this project")
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action((pkg: string, opts: { dir?: string }) => {
    runPluginRemove({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      pkg,
    });
  });

plugin
  .command("list")
  .description("List plugins configured for this project")
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action(async (opts: { dir?: string }) => {
    await runPluginList({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    });
  });

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
