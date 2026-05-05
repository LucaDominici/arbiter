import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ArbiterConfigV2 } from "../../src/config/schema.js";

vi.mock("../../src/utils/run-cli.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/utils/run-cli.js")>();
  return {
    ...actual,
    runCli: vi.fn(),
    runCliJson: vi.fn(),
  };
});

import { runCli, runCliJson, CliError } from "../../src/utils/run-cli.js";
import { GitHubBackend } from "../../src/decomposition/github-backend.js";

const mockRunCli = vi.mocked(runCli);
const mockRunCliJson = vi.mocked(runCliJson);

function baseConfig(repo = "owner/my-repo"): ArbiterConfigV2 {
  const [owner, repoName] = repo.split("/");
  return {
    version: "0.2",
    tools: ["claude"],
    governanceLevel: "L2",
    useGitHub: true,
    decomposition: {
      backend: "github",
      github: { owner, repo: repoName },
    },
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: false,
      evidenceHarness: false,
      debtGates: false,
      suppressions: true,
    },
    thresholds: {
      lineCoverage: 80,
      branchCoverage: 70,
      mutationScore: 80,
      cyclomaticComplexity: 15,
      methodLength: 65,
      maxParams: 7,
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GitHubBackend", () => {
  it("has id 'github'", () => {
    const b = new GitHubBackend(baseConfig());
    expect(b.id).toBe("github");
  });

  describe("list", () => {
    it("calls gh issue list with --json flag and returns mapped WorkUnits", async () => {
      mockRunCliJson.mockReturnValue([
        { number: 1, title: "Fix bug", state: "OPEN", labels: [] },
        {
          number: 2,
          title: "Add feature",
          state: "CLOSED",
          labels: [{ name: "feature" }],
        },
      ]);

      const backend = new GitHubBackend(baseConfig());
      const units = await backend.list();

      expect(mockRunCliJson).toHaveBeenCalledWith(
        "gh",
        expect.arrayContaining(["issue", "list"]),
        expect.anything(),
      );
      expect(units).toHaveLength(2);
      expect(units[0].id).toBe("#1");
      expect(units[0].title).toBe("Fix bug");
      expect(units[0].status).toBe("open");
      expect(units[1].status).toBe("done");
      expect(units[1].labels).toContain("feature");
    });

    it("filters by status=open -> passes --state open to gh", async () => {
      mockRunCliJson.mockReturnValue([]);
      const backend = new GitHubBackend(baseConfig());
      await backend.list({ status: "open" });
      expect(mockRunCliJson).toHaveBeenCalledWith(
        "gh",
        expect.arrayContaining(["--state", "open"]),
        expect.anything(),
      );
    });

    it("filters by status=done -> passes --state closed to gh", async () => {
      mockRunCliJson.mockReturnValue([]);
      const backend = new GitHubBackend(baseConfig());
      await backend.list({ status: "done" });
      expect(mockRunCliJson).toHaveBeenCalledWith(
        "gh",
        expect.arrayContaining(["--state", "closed"]),
        expect.anything(),
      );
    });
  });

  describe("get", () => {
    it("calls gh issue view and returns mapped WorkUnit", async () => {
      mockRunCliJson.mockReturnValue({
        number: 42,
        title: "Specific issue",
        state: "OPEN",
        body: "details",
        labels: [{ name: "task" }],
      });

      const backend = new GitHubBackend(baseConfig());
      const unit = await backend.get("#42");

      expect(mockRunCliJson).toHaveBeenCalledWith(
        "gh",
        expect.arrayContaining(["issue", "view", "42"]),
        expect.anything(),
      );
      expect(unit).not.toBeNull();
      expect(unit!.id).toBe("#42");
      expect(unit!.body).toBe("details");
    });

    it("returns null on CliError (issue not found)", async () => {
      mockRunCliJson.mockImplementation(() => {
        throw new CliError(
          {
            cmd: "gh",
            args: ["issue", "view", "999"],
            exitCode: 1,
            stdout: "",
            stderr: "not found",
            timedOut: false,
            notFound: false,
          },
          "not found",
        );
      });

      const backend = new GitHubBackend(baseConfig());
      const result = await backend.get("#999");
      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    it("calls gh issue create and returns WorkUnit with number-based id", async () => {
      mockRunCliJson.mockReturnValue({ number: 7 });

      const backend = new GitHubBackend(baseConfig());
      const unit = await backend.create({
        title: "New issue",
        status: "open",
        labels: ["task"],
      });

      expect(mockRunCliJson).toHaveBeenCalledWith(
        "gh",
        expect.arrayContaining([
          "issue",
          "create",
          "--title",
          "New issue",
          "--json",
          "number",
        ]),
        expect.anything(),
      );
      expect(unit.id).toBe("#7");
      expect(unit.title).toBe("New issue");
    });
  });

  describe("advance", () => {
    it("calls gh issue edit to set label for phase", async () => {
      mockRunCliJson.mockReturnValue({
        number: 5,
        title: "Test",
        state: "OPEN",
        labels: [],
      });
      mockRunCli.mockReturnValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 0,
      });

      const backend = new GitHubBackend(baseConfig());
      await backend.advance("#5", "implementation");

      expect(mockRunCli).toHaveBeenCalledWith(
        "gh",
        expect.arrayContaining(["issue", "edit", "5"]),
        expect.anything(),
      );
    });
  });

  describe("close", () => {
    it("calls gh issue close", async () => {
      mockRunCli.mockReturnValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 0,
      });

      const backend = new GitHubBackend(baseConfig());
      await backend.close("#3", { reason: "fixed" });

      expect(mockRunCli).toHaveBeenCalledWith(
        "gh",
        expect.arrayContaining(["issue", "close", "3"]),
        expect.anything(),
      );
    });
  });
});
