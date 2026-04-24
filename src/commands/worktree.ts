import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { runCli, CliError } from "../utils/run-cli.js";
import { loadConfig } from "../utils/config.js";
import {
  sanitizeTaskId,
  branchNameFor,
  resolveWorktreeBase,
  worktreePathFor,
} from "../worktree/paths.js";
import { materializeLink, checkLinkIntegrity } from "../worktree/links.js";
import { harvestFiles } from "../worktree/harvest.js";
import type { HarvestOptions } from "../worktree/harvest.js";
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
  { path: "node_modules", required: false, type: "directory" },
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
    const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!Array.isArray(raw)) {
      throw new SyntaxError(`Expected JSON array, got ${typeof raw}`);
    }
    return raw as unknown[];
  } catch (err) {
    if (!(err instanceof SyntaxError)) {
      throw err;
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${path}.corrupt-${ts}`;
    let moved = false;
    try {
      renameSync(path, backupPath);
      moved = true;
    } catch {
      // rename best-effort; still return []
    }
    process.stderr.write(
      moved
        ? `Warning: corrupt JSON at ${path} — moved to ${backupPath}\n`
        : `Warning: corrupt JSON at ${path} — could not back up (rename failed); original may be overwritten\n`,
    );
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
  /** Copy modified/untracked files from worktree back to main repo before closing. */
  harvest?: boolean;
  /** When harvesting, skip merge check (implies --force for cleanup). */
  harvestAll?: boolean;
  /** Callback for each harvested file (used in tests). */
  onHarvestFile?: HarvestOptions["onFile"];
}

export interface WorktreeListOptions {
  cwd?: string;
  /** Receive output lines instead of printing them (used in tests). */
  onLine?: (line: string) => void;
}

// ---------------------------------------------------------------------------
// open helpers
// ---------------------------------------------------------------------------

interface LinkSummary {
  linked: number;
  linkedDir: number;
  copied: number;
  copiedDir: number;
  missing: number;
}

function materializeLinks(
  specs: WorktreeLinkSpec[],
  gitRoot: string,
  worktreePath: string,
): LinkSummary {
  const summary: LinkSummary = {
    linked: 0,
    linkedDir: 0,
    copied: 0,
    copiedDir: 0,
    missing: 0,
  };
  for (const spec of specs) {
    const result = materializeLink(spec, gitRoot, worktreePath);
    if (result.result === "LINKED") summary.linked++;
    else if (result.result === "LINKED_DIR") summary.linkedDir++;
    else if (result.result === "COPIED_TEMPLATE") summary.copied++;
    else if (result.result === "COPIED_DIR") summary.copiedDir++;
    else summary.missing++;
  }
  return summary;
}

function printLinkSummary(summary: LinkSummary): void {
  console.log(
    `Links:          ${summary.linked} linked, ${summary.linkedDir} linked-dir, ${summary.copied} copied-from-template, ${summary.copiedDir} copied-dir, ${summary.missing} missing`,
  );
}

function resolveEffectiveBase(baseBranch: string, gitRoot: string): string {
  try {
    runCli("git", ["rev-parse", "--verify", `refs/heads/${baseBranch}`], {
      cwd: gitRoot,
    });
    return baseBranch;
  } catch (err) {
    if (err instanceof CliError && !err.notFound && !err.timedOut) {
      try {
        runCli(
          "git",
          ["rev-parse", "--verify", `refs/remotes/origin/${baseBranch}`],
          { cwd: gitRoot },
        );
        return `origin/${baseBranch}`;
      } catch (innerErr) {
        if (
          innerErr instanceof CliError &&
          !innerErr.notFound &&
          !innerErr.timedOut
        ) {
          throw new Error(
            `Base branch '${baseBranch}' does not exist. ` +
              "Create it or specify a different base with --base.",
            { cause: innerErr },
          );
        }
        throw innerErr;
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// open
// ---------------------------------------------------------------------------

export function runWorktreeOpen(opts: WorktreeOpenOptions): void {
  const cwd = opts.cwd ?? process.cwd();
  const gitRoot = getGitRoot(cwd);

  if (!isRunningFromMainRepo(gitRoot)) {
    throw new Error(
      "Must run from the main repository, not a worktree. " +
        "The .git entry at this path is a file (gitdir pointer), not a directory.",
    );
  }

  if (workingTreeDirty(cwd)) {
    throw new Error(
      "Working tree has uncommitted changes. " +
        "Commit or stash your changes before opening a worktree.",
    );
  }

  const taskId = sanitizeTaskId(opts.taskId);
  const slug = opts.slug;
  const branchName = branchNameFor(taskId, slug);
  const baseBranch = opts.base ?? "main";

  const config = loadConfig(gitRoot);
  const wtConfig = config?.worktree ?? defaultWorktreeConfig();

  const worktreeBase = resolveWorktreeBase(
    gitRoot,
    wtConfig.base,
    opts.worktreesDir ?? process.env["ARBITER_WORKTREES_DIR"],
  );
  const worktreePath = worktreePathFor(worktreeBase, taskId, slug);

  if (existsSync(worktreePath)) {
    throw new Error(
      `Worktree already exists at: ${worktreePath}\n` +
        "Run 'arbiter worktree list' to see open worktrees.",
    );
  }

  const effectiveBase = resolveEffectiveBase(baseBranch, gitRoot);

  const baseRef = runCli("git", ["rev-parse", "--short", effectiveBase], {
    cwd: gitRoot,
  }).stdout.trim();

  mkdirSync(worktreeBase, { recursive: true });
  runCli(
    "git",
    ["worktree", "add", "-b", branchName, worktreePath, effectiveBase],
    { cwd: gitRoot },
  );

  const linkSummary = materializeLinks(wtConfig.links, gitRoot, worktreePath);

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

  console.log(`\nWorktree ready: ${worktreePath}`);
  console.log(`Branch:         ${branchName}`);
  console.log(`Base:           ${baseBranch} @ ${baseRef}`);
  printLinkSummary(linkSummary);
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
): boolean {
  try {
    runCli("git", ["branch", "-d", branch], { cwd: gitRoot });
    return true;
  } catch (softErr) {
    if (!force) {
      process.stderr.write(
        `Warning: could not delete branch '${branch}': ${softErr instanceof Error ? softErr.message : String(softErr)}\n`,
      );
      return false;
    }
    try {
      runCli("git", ["branch", "-D", branch], { cwd: gitRoot });
      return true;
    } catch (hardErr) {
      process.stderr.write(
        `Warning: could not force-delete branch '${branch}': ${hardErr instanceof Error ? hardErr.message : String(hardErr)}\n`,
      );
      return false;
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
// close helpers
// ---------------------------------------------------------------------------

function harvestAndReport(
  worktreePath: string,
  gitRoot: string,
  harvestAll: boolean,
  onHarvestFile?: HarvestOptions["onFile"],
): void {
  const harvestOpts: HarvestOptions = {
    worktreePath,
    mainRepoPath: gitRoot,
    autoConfirm: harvestAll,
  };
  if (onHarvestFile) {
    harvestOpts.onFile = onHarvestFile;
  }
  const result = harvestFiles(harvestOpts);

  if (result.copied.length > 0) {
    console.log(`Harvested ${result.copied.length} file(s):`);
    for (const f of result.copied) {
      console.log(`  copied: ${f}`);
    }
  }
  if (result.skipped.length > 0) {
    console.log(
      `Skipped ${result.skipped.length} file(s) (uncommitted changes in main repo):`,
    );
    for (const f of result.skipped) {
      console.log(`  skipped: ${f}`);
    }
  }
  if (result.copied.length === 0 && result.skipped.length === 0) {
    console.log("No files to harvest (worktree has no changes).");
  }
}

interface CloseValidationParams {
  worktreePath: string;
  branch: string;
  baseBranch: string;
  gitRoot: string;
  force: boolean;
  harvestAll: boolean;
  noFetch: boolean;
}

function validateBeforeClose(params: CloseValidationParams): void {
  const {
    worktreePath,
    branch,
    baseBranch,
    gitRoot,
    force,
    harvestAll,
    noFetch,
  } = params;
  if (workingTreeDirty(worktreePath) && !force && !harvestAll) {
    throw new Error(
      `Worktree has uncommitted changes at: ${worktreePath}\n` +
        "Commit or stash your changes, then retry. Use --force to close anyway.",
    );
  }

  if (harvestAll) {
    process.stderr.write(
      `Warning: harvest-all: skipping merge check; any un-merged commits on '${branch}' will be permanently lost.\n`,
    );
  } else {
    assertBranchMerged(branch, baseBranch, gitRoot, noFetch, force);
  }
}

function resolveOpenEntry(logPath: string, taskId: string): OpenLogEntry {
  const openEntries = readJsonArray(logPath) as OpenLogEntry[];
  const entry = openEntries.find(
    (e) => e.taskId === taskId && existsSync(e.worktreePath),
  );
  if (!entry) {
    const staleIdx = openEntries.findIndex(
      (e) => e.taskId === taskId && !existsSync(e.worktreePath),
    );
    const staleEntry = staleIdx !== -1 ? openEntries[staleIdx] : undefined;
    if (staleEntry !== undefined) {
      process.stderr.write(
        `Worktree directory missing — removing stale log entry for task ${taskId} ` +
          `(was: ${staleEntry.worktreePath})\n`,
      );
      openEntries.splice(staleIdx, 1);
      writeJsonArray(logPath, openEntries);
    }
    throw new Error(
      `No open worktree found for task ${taskId}. ` +
        "Run 'arbiter worktree list' to see open worktrees.",
    );
  }
  return entry;
}

function warnDanglingLinks(
  links: WorktreeLinkSpec[],
  worktreePath: string,
  warn: (msg: string) => void,
): void {
  for (const d of checkLinkIntegrity(links, worktreePath)) {
    warn(`Warning: dangling symlink: ${d}`);
  }
}

// ---------------------------------------------------------------------------
// close
// ---------------------------------------------------------------------------

export function runWorktreeClose(opts: WorktreeCloseOptions): void {
  const cwd = opts.cwd ?? process.cwd();
  const force = opts.force ?? false;
  const noFetch = opts.noFetch ?? false;
  const harvest = opts.harvest ?? false;
  const harvestAll = opts.harvestAll ?? false;
  const effectiveForce = force || harvestAll;
  const warn =
    opts.onWarning ??
    ((msg: string): void => {
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
  const entry = resolveOpenEntry(logPath, taskId);

  const { worktreePath, branch, baseBranch } = entry;

  if (harvest || harvestAll) {
    harvestAndReport(worktreePath, gitRoot, harvestAll, opts.onHarvestFile);
  }

  validateBeforeClose({
    worktreePath,
    branch,
    baseBranch,
    gitRoot,
    force,
    harvestAll,
    noFetch,
  });

  const config = loadConfig(gitRoot);
  const wtConfig = config?.worktree ?? defaultWorktreeConfig();
  warnDanglingLinks(wtConfig.links, worktreePath, warn);

  runCloseHookIfConfigured(wtConfig.closeHook, worktreePath, gitRoot, force);

  runCli("git", ["worktree", "remove", "--force", worktreePath], {
    cwd: gitRoot,
  });
  runCli("git", ["worktree", "prune"], { cwd: gitRoot });

  if (!opts.keepBranch) {
    if (deleteTaskBranch(branch, gitRoot, effectiveForce)) {
      console.log(`Branch ${branch} deleted.`);
    }
  }

  const closeLogPath = join(arbiterLogDir(gitRoot), "worktree-close.log.json");
  const closeEntries = readJsonArray(closeLogPath) as CloseLogEntry[];
  closeEntries.push({
    taskId,
    branch,
    worktreePath,
    closedAt: new Date().toISOString(),
    force: effectiveForce,
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
    ((line: string): void => {
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
