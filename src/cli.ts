#!/usr/bin/env node
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runUpdate } from "./commands/update.js";
import { runDiff } from "./commands/diff.js";
import { runConfigure } from "./commands/configure.js";
import {
  runWorktreeOpen,
  runWorktreeClose,
  runWorktreeList,
} from "./commands/worktree.js";
import { runVerify, runVerifyEvidence } from "./commands/verify.js";
import { runReviewCode, runReviewPlan } from "./commands/review.js";
import { jsonOutput } from "./utils/json-output.js";
import type { ReviewTier } from "./review/tier-constants.js";
import { runUpgradeLevel } from "./commands/upgrade-level.js";
import {
  runPluginAdd,
  runPluginRemove,
  runPluginList,
} from "./commands/plugin.js";
import { runTaskAdvance } from "./commands/task.js";
import type { TaskPhase } from "./commands/task.js";
import { runHarness } from "./commands/harness.js";
import { runKnowledgeMapUpdate } from "./commands/knowledge-map.js";
import {
  runWorkList,
  runWorkCreate,
  runWorkShow,
  runWorkClose,
  runWorkAdvance,
} from "./commands/work.js";
import type { WorkUnitPhase, WorkUnitStatus } from "./decomposition/types.js";
import { appendEvidenceLine } from "./utils/evidence-log.js";
import { parseBooleanEnv } from "./utils/env.js";
import { runCli } from "./utils/run-cli.js";

// ── Evidence logging setup ────────────────────────────────────────────────────

/**
 * Strip --no-evidence from argv before Commander sees it (Commander would
 * reject it as an unknown option on subcommands), and capture the flag value.
 */
const _rawArgv = process.argv.slice(2);
const _noEvidenceIdx = _rawArgv.indexOf("--no-evidence");
const _noEvidence =
  _noEvidenceIdx !== -1 ||
  parseBooleanEnv(process.env["ARBITER_NO_EVIDENCE"]) === true;
if (_noEvidenceIdx !== -1) {
  process.argv.splice(2 + _noEvidenceIdx, 1);
}

/** Resolve git HEAD SHA once at startup; fall back to "unknown" in non-git dirs. */
function resolveHeadSha(): string {
  try {
    return runCli("git", ["rev-parse", "--short", "HEAD"]).stdout.trim();
  } catch {
    return "unknown";
  }
}

const _headSha = _noEvidence ? "" : resolveHeadSha();
const _startMs = Date.now();

/**
 * Derive cmd + args from process.argv (after Commander strips the node binary
 * and script path).
 * Convention: `cmd` = top-level subcommand (e.g. "init", "worktree open"),
 *             `args` = remaining tokens after the subcommand.
 */
function parseCmdArgs(): { cmd: string; args: string[] } {
  const tokens = process.argv.slice(2);
  if (tokens.length === 0) return { cmd: "", args: [] };
  // Handle nested commands like "worktree open" / "task advance" / "work list"
  const nested: ReadonlySet<string> = new Set([
    "worktree",
    "wt",
    "task",
    "plugin",
    "work",
  ]);
  const first = tokens[0] ?? "";
  if (nested.has(first) && tokens.length >= 2) {
    const sub = tokens[1] ?? "";
    // Skip flags as second token (e.g. "worktree --help")
    if (!sub.startsWith("-")) {
      return { cmd: `${first} ${sub}`, args: tokens.slice(2) };
    }
  }
  return { cmd: first, args: tokens.slice(1) };
}

const _parsedCmd = parseCmdArgs();

let _evidenceLogged = false;

process.on("exit", (code) => {
  if (_evidenceLogged || _noEvidence) return;
  _evidenceLogged = true;
  appendEvidenceLine({
    ts: new Date().toISOString(),
    cmd: _parsedCmd.cmd,
    args: _parsedCmd.args,
    exit: code,
    durationMs: Date.now() - _startMs,
    headSha: _headSha,
  });
});

// ─────────────────────────────────────────────────────────────────────────────

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
  .option(
    "--backend <backend>",
    "Decomposition backend: github or markdown (overrides gh auth detection)",
  )
  .option("--json", "Emit machine-readable JSON output (requires --yes)", false)
  .action(
    async (opts: {
      yes: boolean;
      tools?: string;
      level?: string;
      dir?: string;
      dryRun: boolean;
      brownfield: boolean;
      verify: boolean;
      acceptBetaTools: boolean;
      backend?: string;
      json: boolean;
    }) => {
      const backend =
        opts.backend === "github" || opts.backend === "markdown"
          ? opts.backend
          : undefined;
      await runInit({
        yes: opts.yes,
        tools: opts.tools,
        level: opts.level,
        dir: opts.dir,
        dryRun: opts.dryRun,
        brownfield: opts.brownfield,
        noVerify: !opts.verify,
        acceptBetaTools: opts.acceptBetaTools,
        ...(backend !== undefined ? { backend } : {}),
        json: opts.json,
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
  .option("--json", "Emit machine-readable JSON output", false)
  .action(async (opts: { dir?: string; github: boolean; json: boolean }) => {
    await runUpdate({
      dir: opts.dir,
      github: opts.github,
      json: opts.json,
    });
  });

program
  .command("configure")
  .description("Modify arbiter.json configuration (non-interactive: use --set)")
  .option("--dir <dir>", "Target directory (default: current directory)")
  .option(
    "--set <path=value>",
    "Set a config path to a value (repeatable)",
    (v, acc: string[]) => [...acc, v],
    [] as string[],
  )
  .option("--json", "Emit machine-readable JSON output", false)
  .action(
    (opts: { dir?: string | undefined; set: string[]; json: boolean }) => {
      runConfigure({ dir: opts.dir, sets: opts.set, json: opts.json });
    },
  );

program
  .command("diff")
  .description("Show what arbiter update would change (dry run)")
  .option("--dir <dir>", "Target directory (default: current directory)")
  .option("--json", "Emit machine-readable JSON output", false)
  .action((opts: { dir?: string; json: boolean }) => {
    runDiff({ dir: opts.dir, json: opts.json });
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
  .option("--json", "Emit machine-readable JSON output", false)
  .action(
    (
      taskId: string,
      slug: string | undefined,
      opts: { base: string; json: boolean },
    ) => {
      runWorktreeOpen({
        taskId,
        ...(slug !== undefined ? { slug } : {}),
        base: opts.base,
        json: opts.json,
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
  .option("--json", "Emit machine-readable JSON output", false)
  .action(
    (
      taskId: string,
      opts: {
        force: boolean;
        keepBranch: boolean;
        fetch: boolean;
        harvest: boolean;
        harvestAll: boolean;
        json: boolean;
      },
    ) => {
      runWorktreeClose({
        taskId,
        force: opts.force,
        keepBranch: opts.keepBranch,
        noFetch: !opts.fetch,
        harvest: opts.harvest,
        harvestAll: opts.harvestAll,
        json: opts.json,
      });
    },
  );

worktree
  .command("list")
  .description("List open task worktrees")
  .option("--json", "Emit machine-readable JSON output", false)
  .action((opts: { json: boolean }) => {
    runWorktreeList({ json: opts.json });
  });

const review = program
  .command("review")
  .description("Review artefacts (plans, code) against governance invariants");

review
  .command("plan <file>")
  .description("Review a plan markdown file via a Claude subagent (#235)")
  .option("--dir <dir>", "Project root (default: current directory)")
  .option("--tier <tier>", "Review tier: XS, S, or Standard (default: S)")
  .option("--json", "Emit machine-readable JSON output", false)
  .action(
    (file: string, opts: { dir?: string; tier?: string; json: boolean }) => {
      const tier: ReviewTier | undefined =
        opts.tier === "XS" || opts.tier === "S" || opts.tier === "Standard"
          ? opts.tier
          : undefined;
      if (opts.tier !== undefined && tier === undefined) {
        console.error(
          `  Error: invalid --tier "${opts.tier}". Valid: XS, S, Standard.`,
        );
        process.exit(1);
      }
      const result = runReviewPlan({
        file,
        ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
        ...(tier !== undefined ? { tier } : {}),
        json: opts.json,
      });
      process.exit(result.exitCode);
    },
  );

review
  .command("code")
  .description(
    "Multi-agent code review: dispatch N parallel reviewers based on tier (#236)",
  )
  .option("--dir <dir>", "Project root (default: current directory)")
  .option(
    "--tier <tier>",
    "Review tier: XS, S, or Standard (default: Standard)",
  )
  .option("--diff <ref>", "Git ref to diff against (default: origin/main)")
  .option(
    "--evidence-dir <path>",
    "Override evidence directory (default: .evidence/review-<timestamp>/)",
  )
  .option("--json", "Emit machine-readable JSON output", false)
  .action(
    async (opts: {
      dir?: string;
      tier?: string;
      diff?: string;
      evidenceDir?: string;
      json: boolean;
    }) => {
      const tier: ReviewTier | undefined =
        opts.tier === "XS" || opts.tier === "S" || opts.tier === "Standard"
          ? opts.tier
          : undefined;
      if (opts.tier !== undefined && tier === undefined) {
        console.error(
          `  Error: invalid --tier "${opts.tier}". Valid: XS, S, Standard.`,
        );
        process.exit(1);
      }
      const result = await runReviewCode({
        ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
        ...(tier !== undefined ? { tier } : {}),
        ...(opts.diff !== undefined ? { diffRef: opts.diff } : {}),
        ...(opts.evidenceDir !== undefined
          ? { evidenceDir: opts.evidenceDir }
          : {}),
        json: opts.json,
      });
      process.exit(result.exitCode);
    },
  );

const verify = program
  .command("verify")
  .description("Probe toolchain compatibility for the detected stack")
  .option("--json", "Emit JSON report", false)
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action((opts: { json: boolean; dir?: string }) => {
    runVerify({ json: opts.json, dir: opts.dir });
  });

verify
  .command("evidence")
  .description(
    "Verify the .evidence/SUMMARY.json snapshot (SHA + freshness window).",
  )
  .option("--json", "Emit machine-readable JSON output", false)
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action((opts: { json: boolean; dir?: string }) => {
    const result = runVerifyEvidence({ dir: opts.dir });
    if (opts.json) {
      jsonOutput(
        "verify evidence",
        result.status,
        {
          exitCode: result.exitCode,
          ...(result.skipped !== undefined ? { skipped: result.skipped } : {}),
          ...(result.reason !== undefined ? { reason: result.reason } : {}),
        },
        result.status === "error" && result.reason !== undefined
          ? [result.reason]
          : undefined,
      );
    } else {
      const label = result.status === "ok" ? "OK" : result.status.toUpperCase();
      const tail = result.reason ? ` — ${result.reason}` : "";
      process.stdout.write(`verify evidence: ${label}${tail}\n`);
    }
    process.exit(result.exitCode);
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
  .option("--json", "Emit machine-readable JSON output", false)
  .action(
    (opts: {
      target?: string;
      extend: boolean;
      days?: number;
      dir?: string;
      json: boolean;
    }) => {
      const upgradeOpts: import("./commands/upgrade-level.js").UpgradeLevelOptions =
        { extend: opts.extend, json: opts.json };
      if (opts.target) {
        if (opts.target !== "L2" && opts.target !== "L3") {
          console.error(
            `  Error: invalid --target "${opts.target}". Valid values: L2, L3.`,
          );
          process.exit(1);
        }
        upgradeOpts.target = opts.target;
      }
      if (opts.days !== undefined) upgradeOpts.days = opts.days;
      if (opts.dir !== undefined) upgradeOpts.dir = opts.dir;
      runUpgradeLevel(upgradeOpts);
    },
  );

const task = program.command("task").description("Manage task lifecycle state");

task
  .command("advance")
  .description("Advance (or reverse) the task lifecycle phase")
  .requiredOption(
    "--to <phase>",
    "Target phase (preflight|plan|implementation|verification|complete)",
  )
  .option("--reverse", "Allow backward phase transitions", false)
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action((opts: { to: string; reverse: boolean; dir?: string }) => {
    runTaskAdvance({
      to: opts.to as TaskPhase,
      reverse: opts.reverse,
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    });
  });

const plugin = program
  .command("plugin")
  .description("[BETA] Manage arbiter plugins (API not yet stable)");

plugin
  .command("add <pkg>")
  .description(
    "Add a plugin to this project (validates it is resolvable first)",
  )
  .option("--dir <dir>", "Target directory (default: current directory)")
  .option("--json", "Emit machine-readable JSON output", false)
  .action(async (pkg: string, opts: { dir?: string; json: boolean }) => {
    await runPluginAdd({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      pkg,
      json: opts.json,
    });
  });

plugin
  .command("remove <pkg>")
  .description("Remove a plugin from this project")
  .option("--dir <dir>", "Target directory (default: current directory)")
  .option("--json", "Emit machine-readable JSON output", false)
  .action((pkg: string, opts: { dir?: string; json: boolean }) => {
    runPluginRemove({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      pkg,
      json: opts.json,
    });
  });

plugin
  .command("list")
  .description("List plugins configured for this project")
  .option("--dir <dir>", "Target directory (default: current directory)")
  .option("--json", "Emit machine-readable JSON output", false)
  .action(async (opts: { dir?: string; json: boolean }) => {
    await runPluginList({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      json: opts.json,
    });
  });

const work = program
  .command("work")
  .description("Manage work units via decomposition backend");

work
  .command("list")
  .description("List work units")
  .option("--dir <dir>", "Target directory (default: current directory)")
  .option(
    "--status <status>",
    "Filter by status: open, in_progress, blocked, done",
  )
  .action(async (opts: { dir?: string; status?: string }) => {
    await runWorkList({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      ...(opts.status ? { status: opts.status as WorkUnitStatus } : {}),
    });
  });

work
  .command("create")
  .description("Create a new work unit")
  .requiredOption("--title <title>", "Work unit title")
  .option("--body <body>", "Work unit body/description")
  .option("--label <labels>", "Comma-separated labels")
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action(
    async (opts: {
      title: string;
      body?: string;
      label?: string;
      dir?: string;
    }) => {
      await runWorkCreate({
        ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
        title: opts.title,
        ...(opts.body ? { body: opts.body } : {}),
        ...(opts.label
          ? { labels: opts.label.split(",").map((l) => l.trim()) }
          : {}),
      });
    },
  );

work
  .command("show <id>")
  .description("Show details of a work unit")
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action(async (id: string, opts: { dir?: string }) => {
    await runWorkShow({
      id,
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    });
  });

work
  .command("close <id>")
  .description("Mark a work unit as done")
  .option("--reason <reason>", "Reason for closing")
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action(async (id: string, opts: { reason?: string; dir?: string }) => {
    await runWorkClose({
      id,
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
    });
  });

work
  .command("advance <id>")
  .description("Advance a work unit to a new lifecycle phase")
  .requiredOption(
    "--phase <phase>",
    "Target phase (preflight|plan|implementation|verification|complete)",
  )
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action(async (id: string, opts: { phase: string; dir?: string }) => {
    await runWorkAdvance({
      id,
      phase: opts.phase as WorkUnitPhase,
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    });
  });

program
  .command("harness")
  .description(
    "Run the four SSOT gates (ssot-core, doc-links, knowledge-map, canonical-paths)",
  )
  .option("--fast", "Stop at first gate failure", false)
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action((opts: { fast: boolean; dir?: string }) => {
    const result = runHarness({
      fast: opts.fast,
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    });
    process.exit(result.exitCode);
  });

program
  .command("knowledge-map")
  .description("Regenerate KNOWLEDGE_MAP.md line counts from current doc sizes")
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action((opts: { dir?: string }) => {
    runKnowledgeMapUpdate({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    });
  });

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
