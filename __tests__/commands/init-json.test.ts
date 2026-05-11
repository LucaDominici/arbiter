import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runInit } from "../../src/commands/init.js";

vi.mock("../../src/detectors/language.js", () => ({
  detectLanguage: vi.fn().mockReturnValue("typescript"),
}));
vi.mock("../../src/detectors/build.js", () => ({
  detectBuildCommands: vi.fn().mockReturnValue({
    buildTool: "tsc",
    buildCommand: "tsc",
    testCommand: "vitest",
    lintCommand: "eslint",
    formatCommand: "prettier",
  }),
}));
vi.mock("../../src/detectors/framework.js", () => ({
  detectFramework: vi.fn().mockReturnValue(null),
}));
vi.mock("../../src/detectors/git.js", () => ({
  detectGitInfo: vi.fn().mockReturnValue({
    isGitRepo: true,
    githubOwner: null,
    githubRepo: null,
  }),
}));
vi.mock("../../src/detectors/existing.js", () => ({
  detectExisting: vi.fn().mockReturnValue({}),
}));
vi.mock("../../src/detectors/github.js", () => ({
  detectGithubAccess: vi.fn().mockReturnValue({ authenticated: false }),
}));
vi.mock("../../src/detectors/lanes.js", () => ({
  detectLanes: vi.fn().mockReturnValue({ lanes: [] }),
}));
vi.mock("../../src/wizard/prompts.js", () => ({
  runWizard: vi.fn().mockResolvedValue(null),
}));

describe("init --json", () => {
  let written: string;

  beforeEach(() => {
    written = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      written += String(chunk);
      return true;
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits JSON error and exits 1 when json=true and yes=false (wizard incompatible)", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      runInit({
        yes: false,
        tools: undefined,
        level: undefined,
        dir: "/tmp/fake",
        dryRun: false,
        brownfield: false,
        noVerify: true,
        json: true,
      }),
    ).rejects.toThrow("process.exit");

    const parsed = JSON.parse(written) as Record<string, unknown>;
    expect(parsed.command).toBe("init");
    expect(parsed.status).toBe("error");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("InitOptions accepts json field", () => {
    // Type check: if json is not in the interface this is a compile error
    const opts: Parameters<typeof runInit>[0] = {
      yes: true,
      tools: undefined,
      level: "L1",
      dir: "/tmp/fake",
      dryRun: false,
      brownfield: false,
      noVerify: true,
      json: true,
    };
    expect(opts.json).toBe(true);
  });
});
