import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MockInstance } from "vitest";

vi.mock("../../src/utils/run-cli.js", () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {
    readonly cmd: string;
    readonly args: readonly string[];
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly timedOut: boolean;
    readonly notFound: boolean;
    constructor(details: {
      cmd: string;
      args: readonly string[];
      exitCode: number;
      stdout: string;
      stderr: string;
      timedOut: boolean;
      notFound?: boolean;
    }) {
      super(
        details.notFound
          ? `Command not found: ${details.cmd}`
          : `Command failed (exit ${details.exitCode})`,
      );
      this.name = "CliError";
      this.cmd = details.cmd;
      this.args = details.args;
      this.exitCode = details.exitCode;
      this.stdout = details.stdout;
      this.stderr = details.stderr;
      this.timedOut = details.timedOut;
      this.notFound = details.notFound ?? false;
    }
  },
}));

import { runCli, CliError } from "../../src/utils/run-cli.js";
import { fetchGithubData } from "../../src/generators/obsidian-vault-github-fetch.js";

const mockRunCli = runCli as unknown as MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchGithubData — short-circuit on missing owner/repo", () => {
  it("returns unavailable when owner is null", () => {
    const result = fetchGithubData(null, "repo");
    expect(result.available).toBe(false);
    expect(result.issues).toEqual([]);
    expect(result.labels).toEqual([]);
    expect(mockRunCli).not.toHaveBeenCalled();
  });

  it("returns unavailable when repo is null", () => {
    const result = fetchGithubData("owner", null);
    expect(result.available).toBe(false);
    expect(mockRunCli).not.toHaveBeenCalled();
  });
});

describe("fetchGithubData — happy path", () => {
  it("returns parsed issues + labels when gh succeeds", () => {
    const issuesStdout = JSON.stringify([
      {
        number: 1,
        title: "bug",
        state: "open",
        labels: [{ name: "INV-04" }, { name: "other" }],
        url: "https://github.com/o/r/issues/1",
      },
    ]);
    const labelsStdout = JSON.stringify([{ name: "INV-04" }, { name: "bug" }]);
    mockRunCli
      .mockReturnValueOnce({
        stdout: issuesStdout,
        stderr: "",
        exitCode: 0,
        durationMs: 5,
      })
      .mockReturnValueOnce({
        stdout: labelsStdout,
        stderr: "",
        exitCode: 0,
        durationMs: 5,
      });

    const result = fetchGithubData("owner", "repo");
    expect(result.available).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.invariants).toEqual(["INV-04"]);
    expect(result.labels).toHaveLength(2);
    expect(result.labels[0]?.invariant).toBe("INV-04");
    expect(result.labels[1]?.invariant).toBeNull();
  });
});

describe("fetchGithubData — classified failures → available:false", () => {
  it("returns unavailable when gh is not installed (notFound)", () => {
    mockRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: "gh",
        args: [],
        exitCode: -1,
        stdout: "",
        stderr: "",
        timedOut: false,
        notFound: true,
      });
    });
    const result = fetchGithubData("owner", "repo");
    expect(result.available).toBe(false);
  });

  it("returns unavailable on non-zero gh exit", () => {
    mockRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: "gh",
        args: [],
        exitCode: 1,
        stdout: "",
        stderr: "HTTP 404: Not Found",
        timedOut: false,
      });
    });
    const result = fetchGithubData("owner", "repo");
    expect(result.available).toBe(false);
  });

  it("returns unavailable when gh stdout is malformed JSON", () => {
    mockRunCli
      .mockReturnValueOnce({
        stdout: "not json {",
        stderr: "",
        exitCode: 0,
        durationMs: 2,
      })
      .mockReturnValueOnce({
        stdout: "[]",
        stderr: "",
        exitCode: 0,
        durationMs: 2,
      });
    const result = fetchGithubData("owner", "repo");
    expect(result.available).toBe(false);
  });

  it("returns unavailable when gh JSON shape is wrong (not an array)", () => {
    mockRunCli
      .mockReturnValueOnce({
        stdout: '{"unexpected":"object"}',
        stderr: "",
        exitCode: 0,
        durationMs: 2,
      })
      .mockReturnValueOnce({
        stdout: "[]",
        stderr: "",
        exitCode: 0,
        durationMs: 2,
      });
    const result = fetchGithubData("owner", "repo");
    expect(result.available).toBe(false);
  });
});
