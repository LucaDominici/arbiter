import { describe, it, expect, vi } from "vitest";
import {
  runWorktreeOpen,
  runWorktreeClose,
  runWorktreeList,
} from "../../src/commands/worktree.js";

// Heavy mocking — worktree command has many git operations
vi.mock("../../src/utils/run-cli.js", () => ({
  runCli: vi.fn().mockReturnValue({ stdout: "", stderr: "", exitCode: 0 }),
  CliError: class CliError extends Error {
    stdout: string;
    stderr: string;
    exitCode: number;
    constructor(msg: string) {
      super(msg);
      this.stdout = "";
      this.stderr = "";
      this.exitCode = 1;
    }
  },
}));
vi.mock("../../src/utils/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({ worktree: null }),
}));
vi.mock("../../src/worktree/paths.js", () => ({
  sanitizeTaskId: vi.fn((id: string) => id),
  branchNameFor: vi.fn(
    (id: string, slug?: string) => `task/${id}${slug ? "-" + slug : ""}`,
  ),
  resolveWorktreeBase: vi
    .fn()
    .mockReturnValue("/tmp/arbiter/.claude/worktrees"),
  worktreePathFor: vi.fn(
    (_base: string, id: string) => `/tmp/arbiter/.claude/worktrees/${id}`,
  ),
}));
vi.mock("../../src/worktree/links.js", () => ({
  materializeLink: vi.fn(),
  checkLinkIntegrity: vi.fn().mockReturnValue([]),
}));
vi.mock("../../src/worktree/harvest.js", () => ({
  harvestFiles: vi.fn().mockReturnValue([]),
}));
vi.mock("../../src/worktree/validate.js", () => ({
  isRunningFromMainRepo: vi.fn().mockReturnValue(true),
  workingTreeDirty: vi.fn().mockReturnValue(false),
  branchFullyMerged: vi.fn().mockReturnValue(true),
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue("[]"),
    renameSync: vi.fn(),
  };
});

describe("worktree --json interface shape", () => {
  // These tests are pure structural/type checks — no command is invoked,
  // so no output is produced. No stdout or console spying needed.

  it("WorktreeOpenOptions accepts json field", () => {
    // Structural: if json is not in the interface, this would be a TS compile error
    const opts: Parameters<typeof runWorktreeOpen>[0] = {
      taskId: "123",
      json: true,
    };
    expect(opts.json).toBe(true);
  });

  it("WorktreeCloseOptions accepts json field", () => {
    const opts: Parameters<typeof runWorktreeClose>[0] = {
      taskId: "123",
      json: true,
    };
    expect(opts.json).toBe(true);
  });

  it("WorktreeListOptions accepts json field", () => {
    const opts: Parameters<typeof runWorktreeList>[0] = {
      json: true,
    };
    expect(opts?.json).toBe(true);
  });
});
