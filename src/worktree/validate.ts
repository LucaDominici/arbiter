import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { runCli, CliError } from "../utils/run-cli.js";

/**
 * Returns true when `gitRoot/.git` is a directory — indicating a main (non-worktree) repo.
 * Git worktrees have a `.git` *file* (a gitdir pointer), not a directory.
 */
export function isRunningFromMainRepo(gitRoot: string): boolean {
  const gitPath = join(gitRoot, ".git");
  if (!existsSync(gitPath)) return false;
  return statSync(gitPath).isDirectory();
}

/**
 * Returns true when the working tree at `cwd` has any uncommitted changes
 * (staged or unstaged).
 */
export function workingTreeDirty(cwd: string): boolean {
  // --untracked-files=no excludes untracked/gitignored files (e.g. .env, node_modules)
  // so untracked files don't block worktree creation on a real project.
  const result = runCli(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    { cwd },
  );
  return result.stdout.trim().length > 0;
}

/**
 * Returns true when `branch` is a reachable ancestor of `origin/<baseBranch>`,
 * i.e. the branch has been fully merged into the remote base.
 *
 * @param fetchFirst  When true, runs `git fetch origin` before the check so that
 *                    `origin/<baseBranch>` is not stale. Pass false in tests that
 *                    control the remote state directly.
 */
export function branchFullyMerged(
  branch: string,
  baseBranch: string,
  cwd: string,
  fetchFirst: boolean,
): boolean {
  if (fetchFirst) {
    try {
      runCli("git", ["fetch", "origin"], { cwd, timeoutMs: 30_000 });
    } catch {
      process.stderr.write(
        "Warning: git fetch failed — using cached refs, result may be stale\n",
      );
    }
  }

  const targetRef = `origin/${baseBranch}`;
  try {
    runCli("git", ["merge-base", "--is-ancestor", branch, targetRef], { cwd });
    return true;
  } catch (err) {
    // Exit code 1 from merge-base means "not an ancestor" (expected negative case)
    if (err instanceof CliError && err.exitCode === 1) return false;
    // Any other exit code (e.g. unknown ref) is a real error
    throw err;
  }
}
