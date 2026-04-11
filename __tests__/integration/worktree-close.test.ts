import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  runWorktreeOpen,
  runWorktreeClose,
} from "../../src/commands/worktree.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function initRepo(dir: string): void {
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@arbiter.dev"], {
    cwd: dir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Arbiter Test"], {
    cwd: dir,
    stdio: "ignore",
  });
}

function initBareRemote(dir: string): void {
  execFileSync("git", ["init", "--bare", "-b", "main"], {
    cwd: dir,
    stdio: "ignore",
  });
}

function seedCommit(dir: string): void {
  writeFileSync(join(dir, "README.md"), "# test");
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let repoRoot: string;
let remoteDir: string;
let worktreesDir: string;

beforeEach(() => {
  repoRoot = makeTmpDir("arbiter-wt-close-main-");
  remoteDir = makeTmpDir("arbiter-wt-close-remote-");
  worktreesDir = makeTmpDir("arbiter-wt-close-store-");

  initRepo(repoRoot);
  seedCommit(repoRoot);

  // Wire up a local bare "remote" so the merge-base check has origin/main
  initBareRemote(remoteDir);
  execFileSync("git", ["remote", "add", "origin", remoteDir], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  execFileSync("git", ["push", "origin", "main"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
});

afterEach(() => {
  try {
    execFileSync("git", ["worktree", "prune"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
  } catch {
    // ignore
  }
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(remoteDir, { recursive: true, force: true });
  rmSync(worktreesDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper: open a worktree and simulate merging its branch
// ---------------------------------------------------------------------------

function openAndMerge(taskId: string, slug: string): string {
  runWorktreeOpen({ taskId, slug, cwd: repoRoot, worktreesDir });
  const wtPath = join(worktreesDir, `${taskId}-${slug}`);

  // Make a commit in the worktree — stage only the feature file, not any symlinks
  // that materializeLink may have created (to avoid merge conflicts). Use a
  // slug-scoped filename so two worktrees for the same task id don't collide.
  const featureFile = `feature-${slug}.txt`;
  writeFileSync(join(wtPath, featureFile), "done");
  execFileSync("git", ["add", featureFile], { cwd: wtPath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "feat: add feature"], {
    cwd: wtPath,
    stdio: "ignore",
  });

  // Merge the branch into main in the main repo
  const branch = `task/${taskId}-${slug}`;
  execFileSync("git", ["merge", "--no-ff", branch, "-m", `Merge ${branch}`], {
    cwd: repoRoot,
    stdio: "ignore",
  });

  // Push main to origin so origin/main is ahead of the branch
  execFileSync("git", ["push", "origin", "main"], {
    cwd: repoRoot,
    stdio: "ignore",
  });

  return wtPath;
}

// ---------------------------------------------------------------------------
// close
// ---------------------------------------------------------------------------

describe("runWorktreeClose", () => {
  it("closes a merged worktree — directory removed, log written", () => {
    openAndMerge("#999", "test");

    runWorktreeClose({
      taskId: "#999",
      cwd: repoRoot,
      noFetch: true, // skip network fetch in test — remote is already up to date
    });

    const wtPath = join(worktreesDir, "#999-test");
    expect(existsSync(wtPath)).toBe(false);

    const logPath = join(repoRoot, ".arbiter", "worktree-close.log.json");
    expect(existsSync(logPath)).toBe(true);
    const entries = JSON.parse(readFileSync(logPath, "utf-8")) as unknown[];
    const entry = entries[0] as Record<string, unknown>;
    expect(entry["taskId"]).toBe("#999");
    expect(entry["force"]).toBe(false);
  });

  it("refuses to close an unmerged branch without --force", () => {
    runWorktreeOpen({
      taskId: "#999",
      slug: "unmerged",
      cwd: repoRoot,
      worktreesDir,
    });
    // Add a commit so the branch has work not yet in origin/main
    const wtPath = join(worktreesDir, "#999-unmerged");
    writeFileSync(join(wtPath, "work.txt"), "wip");
    execFileSync("git", ["add", "."], { cwd: wtPath, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "wip"], {
      cwd: wtPath,
      stdio: "ignore",
    });

    expect(() =>
      runWorktreeClose({ taskId: "#999", cwd: repoRoot, noFetch: true }),
    ).toThrow(/not been merged/i);
  });

  it("closes with --force even when branch is unmerged", () => {
    runWorktreeOpen({
      taskId: "#999",
      slug: "unmerged",
      cwd: repoRoot,
      worktreesDir,
    });
    const wtPath = join(worktreesDir, "#999-unmerged");
    writeFileSync(join(wtPath, "work.txt"), "wip");
    execFileSync("git", ["add", "."], { cwd: wtPath, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "wip"], {
      cwd: wtPath,
      stdio: "ignore",
    });

    runWorktreeClose({
      taskId: "#999",
      force: true,
      cwd: repoRoot,
      noFetch: true,
    });

    expect(existsSync(wtPath)).toBe(false);
  });

  it("detects dangling symlinks and reports them (does not throw)", () => {
    // .env is untracked (as in a real project where it's gitignored).
    // The dirty check uses --untracked-files=no, so this doesn't block opening.
    const envPath = join(repoRoot, ".env");
    writeFileSync(envPath, "SECRET=1");

    openAndMerge("#999", "dangling");

    // Remove .env from the main repo AFTER opening — symlink in worktree now dangles
    rmSync(envPath);

    const warnings: string[] = [];
    runWorktreeClose({
      taskId: "#999",
      cwd: repoRoot,
      noFetch: true,
      onWarning: (w) => warnings.push(w),
    });

    expect(warnings.some((w) => w.includes(".env"))).toBe(true);
    expect(existsSync(join(worktreesDir, "#999-dangling"))).toBe(false);
  });

  it("invokes the close hook and passes the worktree path", () => {
    openAndMerge("#999", "hook");

    // Write a simple hook script that records its argument
    const hookLog = join(repoRoot, "hook-was-called.txt");
    const hookScript = join(repoRoot, "close-hook.sh");
    writeFileSync(hookScript, `#!/bin/sh\necho "$1" > "${hookLog}"\n`);
    execFileSync("chmod", ["+x", hookScript]);

    // Write arbiter.json with hook configured
    writeFileSync(
      join(repoRoot, "arbiter.json"),
      JSON.stringify({
        version: "0.1",
        tools: ["claude"],
        governanceLevel: "L1",
        useGitHub: false,
        worktree: {
          base: worktreesDir,
          links: [],
          closeHook: "./close-hook.sh",
        },
      }),
    );

    runWorktreeClose({ taskId: "#999", cwd: repoRoot, noFetch: true });

    expect(existsSync(hookLog)).toBe(true);
    const wtPath = join(worktreesDir, "#999-hook");
    expect(readFileSync(hookLog, "utf-8").trim()).toBe(resolve(wtPath));
  });

  it("aborts close (without --force) when close hook exits non-zero", () => {
    openAndMerge("#999", "hookfail");

    const hookScript = join(repoRoot, "fail-hook.sh");
    writeFileSync(hookScript, "#!/bin/sh\nexit 1\n");
    execFileSync("chmod", ["+x", hookScript]);

    writeFileSync(
      join(repoRoot, "arbiter.json"),
      JSON.stringify({
        version: "0.1",
        tools: ["claude"],
        governanceLevel: "L1",
        useGitHub: false,
        worktree: {
          base: worktreesDir,
          links: [],
          closeHook: "./fail-hook.sh",
        },
      }),
    );

    expect(() =>
      runWorktreeClose({ taskId: "#999", cwd: repoRoot, noFetch: true }),
    ).toThrow(/close hook failed/i);

    // Worktree must still be present
    expect(existsSync(join(worktreesDir, "#999-hookfail"))).toBe(true);
  });

  it("refuses when no open log entry exists for the task", () => {
    expect(() => runWorktreeClose({ taskId: "#000", cwd: repoRoot })).toThrow(
      /no open worktree/i,
    );
  });

  it("closes the second worktree when two share the same task id", () => {
    // Open two worktrees for the same task id with different slugs
    openAndMerge("#999", "first");
    openAndMerge("#999", "second");

    // Close the first — picks the first matching open-log entry
    runWorktreeClose({ taskId: "#999", cwd: repoRoot, noFetch: true });
    expect(existsSync(join(worktreesDir, "#999-first"))).toBe(false);
    expect(existsSync(join(worktreesDir, "#999-second"))).toBe(true);

    // Close the second — must skip the stale first entry and find the second
    runWorktreeClose({ taskId: "#999", cwd: repoRoot, noFetch: true });
    expect(existsSync(join(worktreesDir, "#999-second"))).toBe(false);
  });
});
