/**
 * runProbes — incompat fixture tests.
 *
 * Validates that runProbes detects version incompatibilities using the
 * incompat-gradle-pitest fixture (a Java project with build.gradle).
 * runCli is mocked to return controlled version strings so the test is
 * hermetic and does not require Gradle/Java to be installed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MockInstance } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);

const FIXTURE_DIR = join(__dir, "../fixtures/incompat-gradle-pitest");

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
      super(`Command failed: ${details.cmd}`);
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

import { runCli } from "../../src/utils/run-cli.js";
import { runProbes } from "../../src/compatibility/probe.js";

const mockRunCli = runCli as MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runProbes — incompat-gradle-pitest fixture", () => {
  it("detects java stack from build.gradle", () => {
    // Java tools: java, gradle, mvn — all respond, then gradlew:help build probe
    mockRunCli.mockImplementation((cmd: string) => {
      if (cmd === "java")
        return {
          stdout: "",
          stderr: 'openjdk version "21.0.1" 2023-10-17',
          exitCode: 0,
          durationMs: 5,
        };
      if (cmd === "gradle")
        return { stdout: "Gradle 8.5", stderr: "", exitCode: 0, durationMs: 5 };
      if (cmd === "mvn")
        return {
          stdout: "Apache Maven 3.9.6",
          stderr: "",
          exitCode: 0,
          durationMs: 5,
        };
      // gradlew:help build probe succeeds
      if (cmd === "./gradlew")
        return {
          stdout: "BUILD SUCCESSFUL",
          stderr: "",
          exitCode: 0,
          durationMs: 100,
        };
      return { stdout: "", stderr: "", exitCode: 0, durationMs: 1 };
    });
    const report = runProbes(FIXTURE_DIR);
    expect(report.stack).toBe("java");
  });

  it("hasFailures=true when Gradle version below >=7", () => {
    mockRunCli.mockImplementation((cmd: string) => {
      if (cmd === "java")
        return {
          stdout: "",
          stderr: 'openjdk version "17.0.9" 2023-10-17',
          exitCode: 0,
          durationMs: 5,
        };
      if (cmd === "gradle")
        return { stdout: "Gradle 6.9", stderr: "", exitCode: 0, durationMs: 5 };
      if (cmd === "mvn")
        return {
          stdout: "Apache Maven 3.9.6",
          stderr: "",
          exitCode: 0,
          durationMs: 5,
        };
      if (cmd === "./gradlew")
        return { stdout: "", stderr: "", exitCode: 0, durationMs: 5 };
      return { stdout: "", stderr: "", exitCode: 0, durationMs: 1 };
    });
    const report = runProbes(FIXTURE_DIR);
    expect(report.hasFailures).toBe(true);
    const gradleProbe = report.probes.find((p) => p.tool === "gradle");
    expect(gradleProbe?.status).toBe("failed");
    expect(gradleProbe?.reason).toMatch(/outside/);
  });

  it("hasFailures=false when all tools meet minimum versions", () => {
    mockRunCli.mockImplementation((cmd: string) => {
      if (cmd === "java")
        return {
          stdout: "",
          stderr: 'openjdk version "21.0.1" 2023-10-17',
          exitCode: 0,
          durationMs: 5,
        };
      if (cmd === "gradle")
        return { stdout: "Gradle 8.5", stderr: "", exitCode: 0, durationMs: 5 };
      if (cmd === "mvn")
        return {
          stdout: "Apache Maven 3.9.6",
          stderr: "",
          exitCode: 0,
          durationMs: 5,
        };
      if (cmd === "./gradlew")
        return {
          stdout: "BUILD SUCCESSFUL",
          stderr: "",
          exitCode: 0,
          durationMs: 100,
        };
      return { stdout: "", stderr: "", exitCode: 0, durationMs: 1 };
    });
    const report = runProbes(FIXTURE_DIR);
    expect(report.hasFailures).toBe(false);
  });

  it("build probe included in probes list with kind=build", () => {
    mockRunCli.mockImplementation((cmd: string) => {
      if (cmd === "java")
        return {
          stdout: "",
          stderr: 'openjdk version "21.0.1" 2023-10-17',
          exitCode: 0,
          durationMs: 5,
        };
      if (cmd === "gradle")
        return { stdout: "Gradle 8.5", stderr: "", exitCode: 0, durationMs: 5 };
      if (cmd === "mvn")
        return {
          stdout: "Apache Maven 3.9.6",
          stderr: "",
          exitCode: 0,
          durationMs: 5,
        };
      if (cmd === "./gradlew")
        return {
          stdout: "BUILD SUCCESSFUL",
          stderr: "",
          exitCode: 0,
          durationMs: 100,
        };
      return { stdout: "", stderr: "", exitCode: 0, durationMs: 1 };
    });
    const report = runProbes(FIXTURE_DIR);
    const buildProbe = report.probes.find((p) => p.kind === "build");
    expect(buildProbe).toBeDefined();
    expect(buildProbe?.tool).toBe("gradlew:version");
    expect(buildProbe?.status).toBe("passed");
  });
});
