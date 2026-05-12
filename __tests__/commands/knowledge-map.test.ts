import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockedFunction,
} from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunCliResult } from "../../src/utils/run-cli.js";

vi.mock("../../src/utils/run-cli.js", () => ({
  runCli: vi.fn(() => ({
    stdout: "  knowledge-map-update: updated 3 entry/entries\n",
    stderr: "",
    exitCode: 0,
    durationMs: 1,
  })),
  CliError: class CliError extends Error {
    stdout = "";
    stderr = "";
    exitCode = 1;
  },
}));

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "km-cmd-test-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(
    join(dir, "scripts", "knowledge-map-update.mjs"),
    `#!/usr/bin/env node\n`,
  );
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("runKnowledgeMapUpdate (#255)", () => {
  let runCliMock: MockedFunction<(...args: unknown[]) => RunCliResult>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const mod = await import("../../src/utils/run-cli.js");
    runCliMock = mod.runCli as MockedFunction<
      (...args: unknown[]) => RunCliResult
    >;
    runCliMock.mockReturnValue({
      stdout: "  knowledge-map-update: updated 3 entry/entries\n",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
    });
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("runs knowledge-map-update.mjs script", async () => {
    const { dir, cleanup } = makeDir();
    try {
      const { runKnowledgeMapUpdate } =
        await import("../../src/commands/knowledge-map.js");
      runKnowledgeMapUpdate({ dir });
      expect(runCliMock).toHaveBeenCalledTimes(1);
      const scriptArg = String(
        (runCliMock.mock.calls[0] as unknown[][])[1]?.[0] ?? "",
      );
      expect(scriptArg).toContain("knowledge-map-update.mjs");
    } finally {
      cleanup();
    }
  });

  it("writes script output to stdout", async () => {
    const { dir, cleanup } = makeDir();
    try {
      const { runKnowledgeMapUpdate } =
        await import("../../src/commands/knowledge-map.js");
      runKnowledgeMapUpdate({ dir });
      const allOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(allOutput).toContain("knowledge-map-update");
    } finally {
      cleanup();
    }
  });

  it("skips when script file does not exist", async () => {
    const { dir, cleanup } = makeDir();
    try {
      rmSync(join(dir, "scripts", "knowledge-map-update.mjs"));
      const { runKnowledgeMapUpdate } =
        await import("../../src/commands/knowledge-map.js");
      runKnowledgeMapUpdate({ dir });
      expect(runCliMock).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("surfaces CliError stdout/stderr before re-throwing on script failure", async () => {
    const { dir, cleanup } = makeDir();
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const mod = await import("../../src/utils/run-cli.js");
      const MockCliError = mod.CliError as new (msg: string) => Error & {
        stdout: string;
        stderr: string;
      };
      const err = new MockCliError("failed");
      err.stdout = "script output\n";
      err.stderr = "script error\n";
      runCliMock.mockImplementationOnce(() => {
        throw err;
      });
      const { runKnowledgeMapUpdate } =
        await import("../../src/commands/knowledge-map.js");
      expect(() => runKnowledgeMapUpdate({ dir })).toThrow();
      const allStdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
      const allStderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(allStdout).toContain("script output");
      expect(allStderr).toContain("script error");
    } finally {
      stderrSpy.mockRestore();
      cleanup();
    }
  });

  it("resolves dir relative to cwd when not provided", async () => {
    const { dir, cleanup } = makeDir();
    try {
      const originalCwd = process.cwd();
      vi.spyOn(process, "cwd").mockReturnValue(dir);
      const { runKnowledgeMapUpdate } =
        await import("../../src/commands/knowledge-map.js");
      runKnowledgeMapUpdate({});
      expect(runCliMock).toHaveBeenCalledTimes(1);
      vi.mocked(process.cwd).mockRestore();
      void originalCwd;
    } finally {
      cleanup();
    }
  });
});
