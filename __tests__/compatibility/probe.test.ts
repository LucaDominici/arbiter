import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MockInstance } from "vitest";

// Mock runCli before importing probe (module-level mock)
vi.mock("../../src/utils/run-cli.js", () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {
    readonly cmd: string;
    readonly args: readonly string[];
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly timedOut: boolean;
    constructor(details: {
      cmd: string;
      args: readonly string[];
      exitCode: number;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    }) {
      super(`Command not found: ${details.cmd}`);
      this.name = "CliError";
      this.cmd = details.cmd;
      this.args = details.args;
      this.exitCode = details.exitCode;
      this.stdout = details.stdout;
      this.stderr = details.stderr;
      this.timedOut = details.timedOut;
    }
  },
}));

import { runCli, CliError } from "../../src/utils/run-cli.js";
import { probeTool, runBuildProbe } from "../../src/compatibility/probe.js";

const mockRunCli = runCli as MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("probeTool — happy path (passed)", () => {
  it("returns passed with parsed version when tool is found and in range", () => {
    mockRunCli.mockReturnValue({
      stdout: "v20.11.1\n",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
    });
    const result = probeTool("node", ["--version"], ">=18", "stdout");
    expect(result.status).toBe("passed");
    expect(result.version).toEqual({ major: 20, minor: 11, patch: 1 });
    expect(result.reason).toBeUndefined();
  });
});

describe("probeTool — ENOENT → skipped", () => {
  it("returns skipped when tool is not installed", () => {
    mockRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: "go",
        args: ["version"],
        exitCode: -1,
        stdout: "",
        stderr: "",
        timedOut: false,
      });
    });
    const result = probeTool("go", ["version"], ">=1.21", "stdout");
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("toolchain-missing");
    expect(result.version).toBeUndefined();
  });
});

describe("probeTool — version outside range → failed", () => {
  it("returns failed when installed version is too old", () => {
    mockRunCli.mockReturnValue({
      stdout: "v16.20.0\n",
      stderr: "",
      exitCode: 0,
      durationMs: 3,
    });
    const result = probeTool("node", ["--version"], ">=18", "stdout");
    expect(result.status).toBe("failed");
    expect(result.version).toEqual({ major: 16, minor: 20, patch: 0 });
    expect(result.reason).toMatch(/outside/);
  });
});

describe("probeTool — stderr output (java)", () => {
  it("parses version from stderr when channel is stderr", () => {
    mockRunCli.mockReturnValue({
      stdout: "",
      stderr: 'openjdk version "21.0.1" 2023-10-17\n',
      exitCode: 0,
      durationMs: 10,
    });
    const result = probeTool("java", ["-version"], ">=17", "stderr");
    expect(result.status).toBe("passed");
    expect(result.version).toEqual({ major: 21, minor: 0, patch: 1 });
  });
});

describe("probeTool — unparseable output → failed", () => {
  it("returns failed when output cannot be parsed", () => {
    mockRunCli.mockReturnValue({
      stdout: "unexpected output\n",
      stderr: "",
      exitCode: 0,
      durationMs: 2,
    });
    const result = probeTool("node", ["--version"], ">=18", "stdout");
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/unrecognized/);
  });
});

// --- build probes ---

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn() };
});

import { existsSync } from "node:fs";
const mockExistsSync = existsSync as MockInstance;

describe("runBuildProbe — requires file missing → skipped", () => {
  it("returns skipped when required file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    const result = runBuildProbe("/some/dir", {
      name: "gradlew:help",
      command: "./gradlew",
      args: ["help", "--offline"],
      requires: "gradlew",
    });
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("build-file-not-found");
    expect(result.kind).toBe("build");
    expect(mockRunCli).not.toHaveBeenCalled();
  });
});

describe("runBuildProbe — command succeeds → passed", () => {
  it("returns passed when command exits 0", () => {
    mockExistsSync.mockReturnValue(true);
    mockRunCli.mockReturnValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      durationMs: 100,
    });
    const result = runBuildProbe("/some/dir", {
      name: "gradlew:help",
      command: "./gradlew",
      args: ["help", "--offline"],
      requires: "gradlew",
    });
    expect(result.status).toBe("passed");
    expect(result.kind).toBe("build");
    expect(mockRunCli).toHaveBeenCalledWith(
      "./gradlew",
      ["help", "--offline"],
      expect.objectContaining({ cwd: "/some/dir" }),
    );
  });
});

describe("runBuildProbe — CliError → failed", () => {
  it("returns failed with stderr excerpt when command fails", () => {
    mockExistsSync.mockReturnValue(true);
    mockRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: "./gradlew",
        args: ["help", "--offline"],
        exitCode: 1,
        stdout: "",
        stderr: "FAILURE: Build failed with an exception.",
        timedOut: false,
      });
    });
    const result = runBuildProbe("/some/dir", {
      name: "gradlew:help",
      command: "./gradlew",
      args: ["help", "--offline"],
      requires: "gradlew",
    });
    expect(result.status).toBe("failed");
    expect(result.kind).toBe("build");
    expect(result.reason).toContain("FAILURE");
  });
});

describe("runBuildProbe — empty requires → always run", () => {
  it("runs command even when requires is empty string", () => {
    mockExistsSync.mockReturnValue(false); // should not be called for empty requires
    mockRunCli.mockReturnValue({
      stdout: "ruff 0.4.5\n",
      stderr: "",
      exitCode: 0,
      durationMs: 5,
    });
    const result = runBuildProbe("/some/dir", {
      name: "ruff:version",
      command: "ruff",
      args: ["--version"],
      requires: "",
    });
    expect(result.status).toBe("passed");
    expect(result.kind).toBe("build");
  });
});
