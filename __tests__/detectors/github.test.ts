import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/run-cli.js", () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {
    cmd: string;
    args: readonly string[];
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    notFound: boolean;
    constructor(details: {
      cmd: string;
      args: readonly string[];
      exitCode: number;
      stdout: string;
      stderr: string;
      timedOut: boolean;
      notFound: boolean;
    }) {
      super(`Command not found: ${details.cmd}`);
      this.name = "CliError";
      this.cmd = details.cmd;
      this.args = details.args;
      this.exitCode = details.exitCode;
      this.stdout = details.stdout;
      this.stderr = details.stderr;
      this.timedOut = details.timedOut;
      this.notFound = details.notFound;
    }
  },
}));

import { detectGithubAccess } from "../../src/detectors/github.js";
import { runCli } from "../../src/utils/run-cli.js";

const mockRunCli = vi.mocked(runCli);

function ok(stdout: string) {
  return { stdout, stderr: "", exitCode: 0, durationMs: 1 };
}

function enoent() {
  const err = new Error("Command not found: gh") as Error & {
    notFound: boolean;
  };
  err.notFound = true;
  return err;
}

beforeEach(() => {
  mockRunCli.mockReset();
});

describe("detectGithubAccess", () => {
  it("returns available:false when gh CLI is not installed", () => {
    mockRunCli.mockImplementationOnce(() => {
      throw enoent();
    });

    const result = detectGithubAccess();

    expect(result.available).toBe(false);
    expect(result.authenticated).toBe(false);
    expect(result.username).toBeNull();
    expect(result.error).toContain("gh CLI not found");
  });

  it("returns authenticated:true via JSON auth path when gh is installed and logged in", () => {
    mockRunCli
      .mockReturnValueOnce(ok("gh version 2.40.0"))
      .mockReturnValueOnce(
        ok(JSON.stringify({ loggedIn: true, user: { login: "octocat" } })),
      );

    const result = detectGithubAccess();

    expect(result.available).toBe(true);
    expect(result.authenticated).toBe(true);
    expect(result.username).toBe("octocat");
    expect(result.error).toBeNull();
  });

  it("returns authenticated:false via JSON auth path when loggedIn is false", () => {
    mockRunCli
      .mockReturnValueOnce(ok("gh version 2.40.0"))
      .mockReturnValueOnce(ok(JSON.stringify({ loggedIn: false })));

    const result = detectGithubAccess();

    expect(result.available).toBe(true);
    expect(result.authenticated).toBe(false);
    expect(result.username).toBeNull();
    expect(result.error).toContain("Not authenticated");
  });

  it("falls back to text parsing when JSON auth throws and text says Logged in", () => {
    mockRunCli
      .mockReturnValueOnce(ok("gh version 2.40.0"))
      .mockImplementationOnce(() => {
        throw new Error("exit 1");
      })
      .mockReturnValueOnce(
        ok("Logged in to github.com account octocat (keyring)"),
      );

    const result = detectGithubAccess();

    expect(result.available).toBe(true);
    expect(result.authenticated).toBe(true);
  });

  it("falls back to text parsing when JSON auth returns invalid JSON", () => {
    mockRunCli
      .mockReturnValueOnce(ok("gh version 2.40.0"))
      .mockReturnValueOnce(ok("not valid json"))
      .mockReturnValueOnce(
        ok("Logged in to github.com account someuser (keyring)"),
      );

    const result = detectGithubAccess();

    expect(result.available).toBe(true);
    expect(result.authenticated).toBe(true);
  });

  it("returns authenticated:false when text fallback contains no logged-in indicator", () => {
    mockRunCli
      .mockReturnValueOnce(ok("gh version 2.40.0"))
      .mockImplementationOnce(() => {
        throw new Error("exit 1");
      })
      .mockReturnValueOnce(ok("You are not logged in to any GitHub hosts."));

    const result = detectGithubAccess();

    expect(result.available).toBe(true);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain("Not authenticated");
  });

  it("returns authenticated:true when text contains Active account: true", () => {
    mockRunCli
      .mockReturnValueOnce(ok("gh version 2.40.0"))
      .mockImplementationOnce(() => {
        throw new Error("exit 1");
      })
      .mockReturnValueOnce(ok("Active account: true\nLogged account testuser"));

    const result = detectGithubAccess();

    expect(result.available).toBe(true);
    expect(result.authenticated).toBe(true);
  });
});
