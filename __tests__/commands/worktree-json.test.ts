import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runWorktreeList } from "../../src/commands/worktree.js";

vi.mock("../../src/utils/run-cli.js", () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {
    stdout = "";
    stderr = "";
    exitCode = 1;
    constructor(msg: string) {
      super(msg);
    }
  },
}));

import { runCli } from "../../src/utils/run-cli.js";

const mockRunCli = runCli as ReturnType<typeof vi.fn>;

describe("runWorktreeList --json envelope shape (W-4)", () => {
  let written: string;

  beforeEach(() => {
    written = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      written += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockRunCli.mockReset();
  });

  function fakeWorktreeList(porcelain: string): void {
    mockRunCli.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "worktree") {
        return { stdout: porcelain, stderr: "", exitCode: 0 };
      }
      if (cmd === "git" && args[0] === "rev-parse") {
        return { stdout: "/tmp/fake-repo\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
  }

  it("emits an empty worktrees array when no task branches exist", () => {
    fakeWorktreeList(`worktree /tmp/fake-repo\nHEAD abc\nbranch refs/heads/main\n`);
    runWorktreeList({ json: true, cwd: "/tmp/fake-repo" });
    const parsed = JSON.parse(written) as Record<string, unknown>;
    expect(parsed.command).toBe("worktree-list");
    expect(parsed.version).toBe("1");
    expect(parsed.status).toBe("ok");
    const data = parsed.data as { worktrees: unknown[] };
    expect(data.worktrees).toEqual([]);
  });

  it("emits task worktrees with path + branch fields", () => {
    fakeWorktreeList(
      `worktree /tmp/fake-repo\n` +
        `HEAD abc\n` +
        `branch refs/heads/main\n\n` +
        `worktree /tmp/fake-repo.worktrees/123\n` +
        `HEAD def\n` +
        `branch refs/heads/task/#123-fix\n\n` +
        `worktree /tmp/fake-repo.worktrees/124\n` +
        `HEAD ghi\n` +
        `branch refs/heads/task/#124-feat\n`,
    );
    runWorktreeList({ json: true, cwd: "/tmp/fake-repo" });
    const parsed = JSON.parse(written) as Record<string, unknown>;
    const data = parsed.data as {
      worktrees: Array<{ path: string; branch: string }>;
    };
    expect(data.worktrees).toHaveLength(2);
    expect(data.worktrees[0]).toMatchObject({
      path: "/tmp/fake-repo.worktrees/123",
      branch: "task/#123-fix",
    });
    expect(data.worktrees[1]).toMatchObject({
      path: "/tmp/fake-repo.worktrees/124",
      branch: "task/#124-feat",
    });
  });

  it("skips non-task branches (e.g. release/*) from --json output", () => {
    fakeWorktreeList(
      `worktree /tmp/fake-repo\n` +
        `HEAD abc\n` +
        `branch refs/heads/main\n\n` +
        `worktree /tmp/fake-repo.worktrees/rel\n` +
        `HEAD def\n` +
        `branch refs/heads/release/v1\n\n` +
        `worktree /tmp/fake-repo.worktrees/123\n` +
        `HEAD ghi\n` +
        `branch refs/heads/task/#123-x\n`,
    );
    runWorktreeList({ json: true, cwd: "/tmp/fake-repo" });
    const parsed = JSON.parse(written) as Record<string, unknown>;
    const data = parsed.data as {
      worktrees: Array<{ path: string; branch: string }>;
    };
    expect(data.worktrees).toHaveLength(1);
    expect(data.worktrees[0]?.branch).toBe("task/#123-x");
  });
});
