import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  lstatSync,
  readlinkSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  runWorktreeOpen,
  runWorktreeList,
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

function seedCommit(dir: string): void {
  writeFileSync(join(dir, "README.md"), "# test");
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let repoRoot: string;
let worktreesDir: string; // overrides the default sibling location

beforeEach(() => {
  repoRoot = makeTmpDir("arbiter-wt-open-");
  initRepo(repoRoot);
  seedCommit(repoRoot);
  // Use an explicit worktrees dir so tests don't scatter sibling dirs
  worktreesDir = makeTmpDir("arbiter-wt-store-");
});

afterEach(() => {
  // Prune worktrees before deleting (git holds locks)
  try {
    execFileSync("git", ["worktree", "prune"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
  } catch {
    // ignore
  }
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(worktreesDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// open
// ---------------------------------------------------------------------------

describe("runWorktreeOpen", () => {
  it("creates a sibling worktree with the expected branch", () => {
    runWorktreeOpen({
      taskId: "#999",
      slug: "test",
      cwd: repoRoot,
      worktreesDir,
    });

    const wtPath = join(worktreesDir, "#999-test");
    expect(existsSync(wtPath)).toBe(true);

    // Branch must be task/#999-test
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd: wtPath,
    })
      .toString()
      .trim();
    expect(branch).toBe("task/#999-test");
  });

  it("links .claude/settings.local.json as an absolute symlink", () => {
    mkdirSync(join(repoRoot, ".claude"));
    writeFileSync(join(repoRoot, ".claude", "settings.local.json"), "{}");

    runWorktreeOpen({
      taskId: "#999",
      slug: "test",
      cwd: repoRoot,
      worktreesDir,
    });

    const linkPath = join(
      worktreesDir,
      "#999-test",
      ".claude",
      "settings.local.json",
    );
    expect(existsSync(linkPath)).toBe(true);
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    // Target must be absolute
    const target = readlinkSync(linkPath);
    expect(target).toBe(resolve(repoRoot, ".claude/settings.local.json"));
  });

  it("writes .arbiter/worktree-open.log.json with task metadata", () => {
    runWorktreeOpen({
      taskId: "#999",
      slug: "test",
      cwd: repoRoot,
      worktreesDir,
    });

    const logPath = join(repoRoot, ".arbiter", "worktree-open.log.json");
    expect(existsSync(logPath)).toBe(true);
    const entries = JSON.parse(readFileSync(logPath, "utf-8")) as unknown[];
    expect(entries).toHaveLength(1);
    const entry = entries[0] as Record<string, unknown>;
    expect(entry["taskId"]).toBe("#999");
    expect(entry["branch"]).toBe("task/#999-test");
    expect(entry["baseBranch"]).toBe("main");
  });

  it("refuses when the working tree has staged changes", () => {
    // Modify an already-tracked file and stage it — that makes the tree dirty
    writeFileSync(join(repoRoot, "README.md"), "modified");
    execFileSync("git", ["add", "README.md"], {
      cwd: repoRoot,
      stdio: "ignore",
    });

    expect(() =>
      runWorktreeOpen({
        taskId: "#999",
        slug: "dirty",
        cwd: repoRoot,
        worktreesDir,
      }),
    ).toThrow(/uncommitted/i);
  });

  it("refuses when running from inside a worktree (.git is a file)", () => {
    // First open a valid worktree
    runWorktreeOpen({
      taskId: "#999",
      slug: "inner",
      cwd: repoRoot,
      worktreesDir,
    });
    const innerWt = join(worktreesDir, "#999-inner");

    // Now try to open from inside that worktree
    expect(() =>
      runWorktreeOpen({
        taskId: "#998",
        slug: "nested",
        cwd: innerWt,
        worktreesDir,
      }),
    ).toThrow(/main repository/i);
  });

  it("refuses when the base branch does not exist", () => {
    expect(() =>
      runWorktreeOpen({
        taskId: "#999",
        slug: "test",
        base: "nonexistent-branch",
        cwd: repoRoot,
        worktreesDir,
      }),
    ).toThrow(/does not exist/i);
  });

  it("refuses with a clear message when the worktree already exists (idempotency)", () => {
    runWorktreeOpen({
      taskId: "#999",
      slug: "test",
      cwd: repoRoot,
      worktreesDir,
    });

    expect(() =>
      runWorktreeOpen({
        taskId: "#999",
        slug: "test",
        cwd: repoRoot,
        worktreesDir,
      }),
    ).toThrow(/already exists/i);
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("runWorktreeList", () => {
  it("reports no task worktrees on a fresh repo", () => {
    const lines: string[] = [];
    runWorktreeList({ cwd: repoRoot, onLine: (l) => lines.push(l) });
    expect(lines.join("\n")).toMatch(/no open task worktrees/i);
  });

  it("reports the opened worktree after open", () => {
    runWorktreeOpen({
      taskId: "#999",
      slug: "test",
      cwd: repoRoot,
      worktreesDir,
    });

    const lines: string[] = [];
    runWorktreeList({ cwd: repoRoot, onLine: (l) => lines.push(l) });
    expect(lines.join("\n")).toMatch(/task\/#999-test/);
  });
});

describe("runWorktreeOpen — node_modules handling", () => {
  it("symlinks node_modules when it exists in the main repo", () => {
    mkdirSync(join(repoRoot, "node_modules", "some-pkg"), { recursive: true });
    writeFileSync(
      join(repoRoot, "node_modules", "some-pkg", "index.js"),
      "module.exports = {}",
    );

    runWorktreeOpen({
      taskId: "#777",
      slug: "nodelink",
      cwd: repoRoot,
      worktreesDir,
    });

    const nmLink = join(worktreesDir, "#777-nodelink", "node_modules");
    expect(existsSync(nmLink)).toBe(true);
    expect(lstatSync(nmLink).isSymbolicLink()).toBe(true);
    expect(readlinkSync(nmLink)).toBe(resolve(repoRoot, "node_modules"));
  });

  it("succeeds when node_modules does not exist (MISSING, not error)", () => {
    // No node_modules directory in the main repo
    expect(() =>
      runWorktreeOpen({
        taskId: "#776",
        slug: "nomodules",
        cwd: repoRoot,
        worktreesDir,
      }),
    ).not.toThrow();

    const nmPath = join(worktreesDir, "#776-nomodules", "node_modules");
    expect(existsSync(nmPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #315 — base-branch falls back to origin/<base> when local ref missing
// ---------------------------------------------------------------------------

describe("#315 base-branch origin fallback", () => {
  let remoteDir: string;
  let cloneDir: string;
  let cloneWorktreesDir: string;

  beforeEach(() => {
    // Add a bare remote to the existing repoRoot and push a feature branch
    remoteDir = makeTmpDir("arbiter-wt-315-remote-");
    execFileSync("git", ["init", "--bare", "-b", "main"], {
      cwd: remoteDir,
      stdio: "ignore",
    });
    execFileSync("git", ["remote", "add", "origin", remoteDir], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    execFileSync("git", ["checkout", "-b", "feature/315", "--quiet"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    execFileSync("git", ["push", "origin", "main", "feature/315"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    execFileSync("git", ["checkout", "main", "--quiet"], {
      cwd: repoRoot,
      stdio: "ignore",
    });

    // Clone the remote — feature/315 exists only as origin/feature/315 in the clone
    cloneDir = makeTmpDir("arbiter-wt-315-clone-");
    execFileSync("git", ["clone", remoteDir, cloneDir], { stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@arbiter.dev"], {
      cwd: cloneDir,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.name", "Arbiter Test"], {
      cwd: cloneDir,
      stdio: "ignore",
    });
    cloneWorktreesDir = makeTmpDir("arbiter-wt-315-store-");
  });

  afterEach(() => {
    try {
      execFileSync("git", ["worktree", "prune"], {
        cwd: cloneDir,
        stdio: "ignore",
      });
    } catch {
      // ignore
    }
    rmSync(remoteDir, { recursive: true, force: true });
    rmSync(cloneDir, { recursive: true, force: true });
    rmSync(cloneWorktreesDir, { recursive: true, force: true });
  });

  it("opens worktree using origin/<base> when local ref is absent", () => {
    // Confirm feature/315 is not a local branch in the clone
    expect(() =>
      execFileSync("git", ["rev-parse", "--verify", "refs/heads/feature/315"], {
        cwd: cloneDir,
        stdio: "pipe",
      }),
    ).toThrow();

    // runWorktreeOpen should succeed via origin/feature/315 fallback
    expect(() =>
      runWorktreeOpen({
        taskId: "#315",
        slug: "origin-fallback",
        base: "feature/315",
        cwd: cloneDir,
        worktreesDir: cloneWorktreesDir,
      }),
    ).not.toThrow();

    const wtPath = join(cloneWorktreesDir, "#315-origin-fallback");
    expect(existsSync(wtPath)).toBe(true);
  });
});
