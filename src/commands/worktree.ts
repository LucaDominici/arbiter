import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runCli } from "../utils/run-cli.js";
import { loadConfig } from "../utils/config.js";
import {
  sanitizeTaskId,
  branchNameFor,
  resolveWorktreeBase,
  worktreePathFor,
} from "../worktree/paths.js";
import { materializeLink, checkLinkIntegrity } from "../worktree/links.js";
import {
  isRunningFromMainRepo,
  workingTreeDirty,
  branchFullyMerged,
} from "../worktree/validate.js";
import type { WorktreeConfig, WorktreeLinkSpec } from "../wizard/types.js";

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_LINKS: WorktreeLinkSpec[] = [
  { path: ".claude/settings.local.json", required: false },
  { path: ".env", template: ".env.example", required: false },
];

function defaultWorktreeConfig(): WorktreeConfig {
  return { base: null, links: DEFAULT_LINKS, closeHook: null };
}

// ---------------------------------------------------------------------------
// Log types + helpers
// ---------------------------------------------------------------------------

interface OpenLogEntry {
  taskId: string;
  slug: string | null;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  baseRef: string;
  openedAt: string;
}

interface CloseLogEntry {
  taskId: string;
  branch: string;
  worktreePath: string;
  closedAt: string;
  force: boolean;
}

function arbiterLogDir(gitRoot: string): string {
  return join(gitRoot, ".arbiter");
}

function readJsonArray(path: string): unknown[] {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as unknown[];
  } catch {
    return [];
  }
}

function writeJsonArray(path: string, entries: unknown[]): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(entries, null, 2) + "\n", "utf-8");
}

function getGitRoot(cwd: string): string {
  return runCli("git", ["rev-parse", "--show-toplevel"], { cwd }).stdout.trim();
}

// ---------------------------------------------------------------------------
// Public command options
// ---------------------------------------------------------------------------

export interface WorktreeOpenOptions {
  taskId: string;
  slug?: string;
  base?: string;
  cwd?: string;
  /** Override the worktrees base directory (used in tests; normally via env). */
  worktreesDir?: string;
}

export interface WorktreeCloseOptions {
  taskId: string;
  force?: boolean;
  keepBranch?: boolean;
  /** Skip `git fetch origin` before the merge check. Useful in tests. */
  noFetch?: boolean;
  cwd?: string;
  /** Receive warning lines instead of printing them (used in tests). */
  onWarning?: (msg: string) => void;
}

export interface WorktreeListOptions {
  cwd?: string;
  /** Receive output lines instead of printing them (used in tests). */
  onLine?: (line: string) => void;
}

// ---------------------------------------------------------------------------
// open
// ---------------------------------------------------------------------------

export function runWorktreeOpen(opts: WorktreeOpenOptions): void {
  const cwd = opts.cwd ?? process.cwd();

  // 1. Locate git root
  const gitRoot = getGitRoot(cwd);

  // 2. Must be in a main repo, not a worktree
  if (!isRunningFromMainRepo(gitRoot)) {
    throw new Error(
      "Must run from the main repository, not a worktree. " +
        "The .git entry at this path is a file (gitdir pointer), not a directory.",
    );
  }

  // 3. No dirty working tree
  if (workingTreeDirty(cwd)) {
    throw new Error(
      "Working tree has uncommitted changes. " +
        "Commit or stash your changes before opening a worktree.",
    );
  }

  // 4. Sanitise inputs
  const taskId = sanitizeTaskId(opts.taskId);
  const slug = opts.slug;
  const branchName = branchNameFor(taskId, slug);
  const baseBranch = opts.base ?? "main";

  // 5. Load worktree config
  const config = loadConfig(gitRoot);
  const wtConfig = config?.worktree ?? defaultWorktreeConfig();

  // 6. Resolve worktree path
  const worktreeBase = resolveWorktreeBase(
    gitRoot,
    wtConfig.base,
    opts.worktreesDir ?? process.env["ARBITER_WORKTREES_DIR"],
  );
  const worktreePath = worktreePathFor(worktreeBase, taskId, slug);

  // 7. Idempotency guard
  if (existsSync(worktreePath)) {
    throw new Error(
      `Worktree already exists at: ${worktreePath}\n` +
        "Run 'arbiter worktree list' to see open worktrees.",
    );
  }

  // 8. Verify base branch exists (local ref)
  try {
    runCli("git", ["rev-parse", "--verify", `refs/heads/${baseBranch}`], {
      cwd: gitRoot,
    });
  } catch {
    throw new Error(
      `Base branch '${baseBranch}' does not exist. ` +
        "Create it or specify a different base with --base.",
    );
  }

  // 9. Get short ref for logging
  const baseRef = runCli("git", ["rev-parse", "--short", baseBranch], {
    cwd: gitRoot,
  }).stdout.trim();

  // 10. Create worktree parent directory + worktree with a new branch
  mkdirSync(worktreeBase, { recursive: true });
  runCli(
    "git",
    ["worktree", "add", "-b", branchName, worktreePath, baseBranch],
    {
      cwd: gitRoot,
    },
  );

  // 11. Materialise links
  let linked = 0;
  let copied = 0;
  let missing = 0;
  for (const spec of wtConfig.links) {
    const result = materializeLink(spec, gitRoot, worktreePath);
    if (result.result === "LINKED") linked++;
    else if (result.result === "COPIED_TEMPLATE") copied++;
    else missing++;
  }

  // 12. Write open log
  const logPath = join(arbiterLogDir(gitRoot), "worktree-open.log.json");
  const entries = readJsonArray(logPath) as OpenLogEntry[];
  entries.push({
    taskId,
    slug: slug ?? null,
    worktreePath,
    branch: branchName,
    baseBranch,
    baseRef,
    openedAt: new Date().toISOString(),
  });
  writeJsonArray(logPath, entries);

  // 13. Print result
  console.log(`\nWorktree ready: ${worktreePath}`);
  console.log(`Branch:         ${branchName}`);
  console.log(`Base:           ${baseBranch} @ ${baseRef}`);
  console.log(
    `Links:          ${linked} linked, ${copied} copied-from-template, ${missing} missing`,
  );
  console.log(`\nNext:           cd '${worktreePath}'\n`);
}

// ---------------------------------------------------------------------------
// close helpers
// ---------------------------------------------------------------------------

function runCloseHookIfConfigured(
  hookPath: string | null,
  worktreePath: string,
  gitRoot: string,
  force: boolean,
): void {
  if (!hookPath) return;
  const absPath = resolve(gitRoot, hookPath);
  if (!existsSync(absPath)) {
    if (!force) {
      throw new Error(
        `Close hook not found: ${absPath}\nFix the path in arbiter.json or use --force.`,
      );
    }
    return;
  }
  try {
    runCli(absPath, [resolve(worktreePath)], { timeoutMs: 60_000 });
  } catch (err) {
    if (!force) {
      throw new Error(`Close hook failed: ${(err as Error).message}`, {
        cause: err,
      });
    }
  }
}

function deleteTaskBranch(
  branch: string,
  gitRoot: string,
  force: boolean,
): void {
  try {
    runCli("git", ["branch", "-d", branch], { cwd: gitRoot });
  } catch {
    if (force) {
      try {
        runCli("git", ["branch", "-D", branch], { cwd: gitRoot });
      } catch {
        // Branch cleanup is best-effort
      }
    }
  }
}

function assertBranchMerged(
  branch: string,
  baseBranch: string,
  gitRoot: string,
  noFetch: boolean,
  force: boolean,
): void {
  if (force) return;
  const merged = branchFullyMerged(branch, baseBranch, gitRoot, !noFetch);
  if (!merged) {
    throw new Error(
      `Branch '${branch}' has not been merged into '${baseBranch}'.\n` +
        "Run '/complete-task' to create and merge the PR first.\n" +
        "Use --force to close anyway.",
    );
  }
}

// ---------------------------------------------------------------------------
// close
// ---------------------------------------------------------------------------

export function runWorktreeClose(opts: WorktreeCloseOptions): void {
  const cwd = opts.cwd ?? process.cwd();
  const force = opts.force ?? false;
  const noFetch = opts.noFetch ?? false;
  const warn =
    opts.onWarning ??
    ((msg: string) => {
      console.log(msg);
    });

  const gitRoot = getGitRoot(cwd);

  if (!isRunningFromMainRepo(gitRoot)) {
    throw new Error(
      "Must run 'worktree close' from the main repository, not a worktree.",
    );
  }

  const taskId = sanitizeTaskId(opts.taskId);
  const logPath = join(arbiterLogDir(gitRoot), "worktree-open.log.json");
  const openEntries = readJsonArray(logPath) as OpenLogEntry[];
  const entry = openEntries.find((e) => e.taskId === taskId);
  if (!entry) {
    throw new Error(
      `No open worktree found for task ${taskId}. ` +
        "Run 'arbiter worktree list' to see open worktrees.",
    );
  }

  const { worktreePath, branch, baseBranch } = entry;

  if (!existsSync(worktreePath)) {
    throw new Error(
      `Worktree directory not found: ${worktreePath}\n` +
        "It may have been removed manually. Run 'git worktree prune' to clean up.",
    );
  }

  if (workingTreeDirty(worktreePath) && !force) {
    throw new Error(
      `Worktree has uncommitted changes at: ${worktreePath}\n` +
        "Commit or stash your changes, then retry. Use --force to close anyway.",
    );
  }

  assertBranchMerged(branch, baseBranch, gitRoot, noFetch, force);

  const config = loadConfig(gitRoot);
  const wtConfig = config?.worktree ?? defaultWorktreeConfig();
  const dangling = checkLinkIntegrity(wtConfig.links, worktreePath);
  for (const d of dangling) {
    warn(`Warning: dangling symlink: ${d}`);
  }

  runCloseHookIfConfigured(wtConfig.closeHook, worktreePath, gitRoot, force);

  runCli("git", ["worktree", "remove", "--force", worktreePath], {
    cwd: gitRoot,
  });
  runCli("git", ["worktree", "prune"], { cwd: gitRoot });

  if (!opts.keepBranch) {
    deleteTaskBranch(branch, gitRoot, force);
    console.log(`Branch ${branch} deleted.`);
  }

  const closeLogPath = join(arbiterLogDir(gitRoot), "worktree-close.log.json");
  const closeEntries = readJsonArray(closeLogPath) as CloseLogEntry[];
  closeEntries.push({
    taskId,
    branch,
    worktreePath,
    closedAt: new Date().toISOString(),
    force,
  });
  writeJsonArray(closeLogPath, closeEntries);

  console.log(`\nWorktree closed: ${worktreePath}`);
  console.log();
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export function runWorktreeList(opts: WorktreeListOptions = {}): void {
  const cwd = opts.cwd ?? process.cwd();
  const emit =
    opts.onLine ??
    ((line: string) => {
      console.log(line);
    });
  const gitRoot = getGitRoot(cwd);

  const result = runCli("git", ["worktree", "list", "--porcelain"], {
    cwd: gitRoot,
  });

  // Parse porcelain output into path + branch pairs
  const worktrees: Array<{ path: string; branch: string | null }> = [];
  let currentPath: string | undefined;
  let currentBranch: string | null = null;

  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (currentPath !== undefined) {
        worktrees.push({ path: currentPath, branch: currentBranch });
      }
      currentPath = line.slice("worktree ".length);
      currentBranch = null;
    } else if (line.startsWith("branch ")) {
      currentBranch = line.slice("branch ".length).replace("refs/heads/", "");
    }
  }
  if (currentPath !== undefined) {
    worktrees.push({ path: currentPath, branch: currentBranch });
  }

  // Skip the main worktree (first entry) and filter to task branches
  const taskWorktrees = worktrees
    .slice(1)
    .filter((w) => w.branch?.startsWith("task/"));

  if (taskWorktrees.length === 0) {
    emit("\nNo open task worktrees.\n");
    return;
  }

  emit(`\nOpen task worktrees (${taskWorktrees.length}):\n`);
  for (const wt of taskWorktrees) {
    emit(`  ${wt.branch ?? "(detached)"}  ${wt.path}`);
  }
  emit("");
}
